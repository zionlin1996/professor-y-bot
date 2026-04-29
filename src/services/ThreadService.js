const { randomBytes } = require("crypto");

const threadKey = (id) => `thread:${id}`;
const msgKey = (id) => `msg:${id}`;

/**
 * Lightweight thread data model. Holds history — no I/O, no stealth state.
 * All persistence is handled by ThreadService.
 */
class Thread {
  constructor(id, history = []) {
    this.id = id;
    this.history = history;
  }

  /** Append a message to history. */
  append(role, content) {
    this.history.push({ role, content });
  }

  /** Public archive URL for this thread. */
  toPublicUrl() {
    const base = process.env.EXTERNAL_URL || "http://localhost";
    return `${base}/archive/${this.id}`;
  }

  serialize() {
    // Strip image blocks before writing to Redis to avoid storing large base64 payloads.
    // Array content (text + image blocks) is collapsed to plain text; image-only turns become "[image]".

    return this.history.map((msg) => {
      this.history.map((msg) => {
        if (!Array.isArray(msg.content)) return msg;
        const text = msg.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join(" ");
        return { ...msg, content: text || "[image]" };
      });
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
 * Stealth mode (private chats only):
 *   stealth threads → Redis only; never written to DB, never accessible via load()
 *   non-stealth threads → DB only for history; Redis only for lightweight msgKey tracking
 */
class ThreadService {
  constructor({ store, db, user } = {}) {
    this._store = store;
    this._db = db;
    this._user = user;
    this._stealth = false;
    this._pendingMessageId = null;
    /** The resolved/created Thread for this request. Set by resolveOrCreate(). */
    this.current = null;
  }

  // ---------------------------------------------------------------------------
  // Factory / lifecycle
  // ---------------------------------------------------------------------------

  async create({ chatId } = {}) {
    const id = randomBytes(16).toString("hex");

    if (this._stealth) {
      await this._store.set(threadKey(id), "[]");
      return new Thread(id, []);
    }

    await this._db.thread.create({
      data: { id, chatId: String(chatId ?? "") },
    });
    return new Thread(id, []);
  }

  /**
   * Load a thread by ID from DB. Used by the archive route only.
   * Stealth threads have no DB records and will return an empty Thread,
   * which the archive route correctly treats as "not found".
   */
  async load(threadId) {
    const messages = await this._db.message.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
    });
    const history = messages.flatMap((m) => [
      { role: "user", content: m.content },
      ...(m.response ? [{ role: "assistant", content: m.response }] : []),
    ]);
    return new Thread(threadId, history);
  }

  async resolve(messageId) {
    const threadId = await this._store.get(msgKey(messageId));
    if (!threadId) return null;
    if (this._stealth) {
      const raw = await this._store.get(threadKey(threadId));
      return new Thread(threadId, raw ? JSON.parse(raw) : []);
    }

    return this.load(threadId);
  }

  async resolveOrCreate(incoming) {
    // Stealth is only active for private chats
    this._stealth =
      (this._user?.current?.stealth ?? false) && incoming.isPrivate;

    if (incoming) {
      this.current = await this.resolve(incoming);
    } else if ((incoming.isGroup && incoming.isMention) || incoming.isPrivate) {
      this.current = await this.create({ chatId: incoming.chatId });
    }

    return this.current;
  }

  // ---------------------------------------------------------------------------
  // Message operations — all use this.current set by resolveOrCreate()
  // ---------------------------------------------------------------------------

  /**
   * Append the user message to history and persist a DB record before calling the LLM.
   * Expects a Prompt DTO: text (DB row), content (history / LLM), userId, attachment.
   */
  async appendPrompt(prompt) {
    const thread = this.current;
    thread.append("user", prompt.content);

    if (this._stealth || !this._db) return;
    const record = await this._db.message.create({
      data: {
        threadId: thread.id,
        userId: prompt.userId ? String(prompt.userId) : null,
        content: String(prompt.text),
        attachmentFileId: prompt.attachment?.fileId ?? null,
        attachmentMediaType: prompt.attachment?.mediaType ?? null,
      },
    });
    this._pendingMessageId = record.id;
  }

  /**
   * Persist thread history and update the pending DB message row with the LLM response.
   * Stealth: writes full history to Redis.
   * Non-stealth: updates DB message row only — no Redis write.
   */
  async save({ replyModel = "" } = {}) {
    const thread = this.current;

    if (this._stealth) {
      await this._store.set(
        threadKey(thread.id),
        JSON.stringify(thread.serialize())
      );
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
        },
      });
    } catch (err) {
      console.error("[ThreadService.save] DB error:", err);
    }
  }

  /** Map a Telegram message ID to this thread in Redis for future lookups. */
  async trackMessage(messageId) {
    await this._store.set(msgKey(messageId), this.current.id);
  }

  /** Track multiple message IDs in parallel. */
  async trackMessages(...messageIds) {
    await Promise.all(messageIds.map((id) => this.trackMessage(id)));
  }
}

module.exports = ThreadService;
