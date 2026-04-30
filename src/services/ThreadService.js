const { randomBytes } = require("crypto");

const threadKey = (id) => `thread:${id}`;
const msgKey = (id) => `msg:${id}`;

/**
 * Lightweight thread data model. Holds history — no I/O.
 * All persistence is handled by ThreadService.
 */
class Thread {
  constructor(id, history = [], ephemeral = false) {
    this.id = id;
    this.history = history;
    this.ephemeral = ephemeral;
  }

  append(role, content) {
    this.history.push({ role, content });
  }

  toPublicUrl() {
    const base = process.env.EXTERNAL_URL || "http://localhost";
    return `${base}/archive/${this.id}`;
  }

  serialize() {
    // Strip image blocks before writing to Redis to avoid storing large base64 payloads.
    // Array content (text + image blocks) is collapsed to plain text; image-only turns become "[image]".
    return this.history.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      const text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join(" ");
      return { ...msg, content: text || "[image]" };
    });
  }
}

/**
 * Per-request service for thread lifecycle and message persistence.
 *
 * Dependencies injected via constructor for testability:
 *   store  — src/libs/store (Redis wrapper)
 *   db     — Prisma client or null
 *   user   — UserService instance (provides stealth flag)
 *
 * thread.ephemeral drives all storage branching:
 *   ephemeral=true  — stealth PM: Thread row in DB; history + msgKey tracking in Redis only
 *   ephemeral=false — regular: groups and non-stealth PM; Thread row + Message rows in DB; resolved via messageId/replyMessageId
 */
class ThreadService {
  constructor({ store, db, user } = {}) {
    this._store = store;
    this._db = db;
    this._user = user;
    this._pendingMessageId = null;
    /** The resolved/created Thread for this request. Set by resolveOrCreate(). */
    this.current = null;
  }

  // ---------------------------------------------------------------------------
  // Factory / lifecycle
  // ---------------------------------------------------------------------------

  async create({ chatId, ephemeral = false } = {}) {
    const id = randomBytes(16).toString("hex");
    await this._db.thread.create({ data: { id, chatId: String(chatId ?? ""), ephemeral } });
    if (ephemeral) {
      await this._store.set(threadKey(id), "[]");
    }
    return new Thread(id, [], ephemeral);
  }

  /**
   * Load a regular thread by ID from DB messages.
   * Used by the archive route. Ephemeral threads have no Message rows and are
   * intentionally not accessible here — they return empty → 404.
   */
  async load(threadId) {
    const messages = await this._db.message.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
    });
    const history = messages.flatMap((m) => [
      // TODO: DB only stores the stripped text, so image-only messages have content="".
      // We fall back to a placeholder to avoid the "user messages must have non-empty content"
      // error from the Claude API. Ideally we should re-fetch the image via attachmentFileId
      // and reconstruct the full image block so the LLM retains visual context in long threads.
      { role: "user", content: m.content || (m.attachmentFileId ? "[image]" : "[message]") },
      ...(m.response ? [{ role: "assistant", content: m.response }] : []),
    ]);
    return new Thread(threadId, history);
  }

  async resolve(replyToId) {
    // Non-ephemeral: find via DB Message record (messageId or replyMessageId).
    if (this._db) {
      const msg = await this._db.message.findFirst({
        where: {
          OR: [
            { messageId: String(replyToId) },
            { replyMessageId: String(replyToId) },
          ],
        },
      });
      if (msg) return this.load(msg.threadId);
    }

    // Ephemeral: find via Redis msgKey, load history from Redis.
    const threadId = await this._store.get(msgKey(replyToId));
    if (!threadId) return null;
    const raw = await this._store.get(threadKey(threadId));
    return new Thread(threadId, raw ? JSON.parse(raw) : [], true);
  }

  cleanup() {
    this.current = null;
    this._pendingMessageId = null;
  }

  async resolveOrCreate(incoming) {
    if (incoming.replyToId) {
      this.current = await this.resolve(incoming.replyToId);
    }
    if (
      !this.current &&
      ((incoming.isGroup && incoming.isMention) || incoming.isPrivate)
    ) {
      const ephemeral = incoming.isPrivate && !!this._user?.current?.stealth;
      this.current = await this.create({ chatId: incoming.chatId, ephemeral });
    }

    return this.current;
  }

  // ---------------------------------------------------------------------------
  // Message operations — all use this.current set by resolveOrCreate()
  // ---------------------------------------------------------------------------

  /**
   * Append the user message to history and persist before calling the LLM.
   * Expects a Prompt DTO: text (DB row), content (history / LLM), userId, messageId, attachment.
   *
   * ephemeral: tracks user messageId → threadId in Redis only.
   * regular: creates a Message row in DB.
   */
  async appendPrompt(prompt) {
    const thread = this.current;
    thread.append("user", prompt.content);

    if (thread.ephemeral) {
      await this._store.set(msgKey(prompt.messageId), thread.id);
      return;
    }
    if (!this._db) return;
    const record = await this._db.message.create({
      data: {
        threadId: thread.id,
        userId: prompt.userId ? String(prompt.userId) : null,
        messageId: prompt.messageId ?? null,
        content: String(prompt.text),
        attachmentFileId: prompt.attachment?.fileId ?? null,
        attachmentMediaType: prompt.attachment?.mediaType ?? null,
      },
    });
    this._pendingMessageId = record.id;
  }

  /**
   * Finalize the exchange after the bot reply is sent.
   * replyMessageId — Telegram message_id of the bot's reply (enables future thread continuation).
   *
   * ephemeral: serializes history to Redis + tracks bot reply msgKey → threadId.
   * regular: updates the pending Message row with response, replyModel, replyMessageId.
   */
  async updateReply(replyMessageId, { replyModel = "" } = {}) {
    const thread = this.current;

    if (thread.ephemeral) {
      await this._store.set(
        threadKey(thread.id),
        JSON.stringify(thread.serialize()),
      );
      await this._store.set(msgKey(replyMessageId), thread.id);
      return;
    }

    if (!this._db || !this._pendingMessageId) return;
    const last = thread.history[thread.history.length - 1];
    if (last?.role !== "assistant") return;
    try {
      await this._db.message.update({
        where: { id: this._pendingMessageId },
        data: {
          response: String(last.content),
          replyModel: String(replyModel),
          replyMessageId: String(replyMessageId),
        },
      });
    } catch (err) {
      console.error("[ThreadService.updateReply] DB error:", err);
    }
  }
}

module.exports = ThreadService;
