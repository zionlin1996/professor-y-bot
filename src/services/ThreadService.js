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
 * _dataSource is set in resolveOrCreate() per request:
 *   "store" — stealth PM: Redis only; history serialized to threadKey; msgKey tracks message IDs
 *   "db"    — all group chats and non-stealth PM: DB for thread/message records; messageId column enables DB-native resolution
 */
class ThreadService {
  constructor({ store, db, user } = {}) {
    this._store = store;
    this._db = db;
    this._user = user;
    this._dataSource = null;
    this._pendingMessageId = null;
    /** The resolved/created Thread for this request. Set by resolveOrCreate(). */
    this.current = null;
  }

  // ---------------------------------------------------------------------------
  // Factory / lifecycle
  // ---------------------------------------------------------------------------

  async create({ chatId } = {}) {
    const id = randomBytes(16).toString("hex");

    if (this._dataSource === "store") {
      await this._store.set(threadKey(id), "[]");
    } else {
      await this._db.thread.create({ data: { id, chatId } });
    }

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

  async resolve(replyToId) {
    if (this._dataSource === "store") {
      const threadId = await this._store.get(msgKey(replyToId));
      if (!threadId) return null;
      const raw = await this._store.get(threadKey(threadId));
      return new Thread(threadId, raw ? JSON.parse(raw) : []);
    }

    const msg = await this._db.message.findFirst({
      where: {
        OR: [
          { messageId: String(replyToId) },
          { replyMessageId: String(replyToId) },
        ],
      },
    });
    if (!msg) return null;
    return this.load(msg.threadId);
  }

  async resolveOrCreate(incoming) {
    // Determine the data source for the thread
    this._dataSource =
      incoming.isGroup || !this._user?.current?.stealth ? "db" : "store";

    if (incoming.replyToId) {
      this.current = await this.resolve(incoming.replyToId);
    }
    if (
      !this.current &&
      ((incoming.isGroup && incoming.isMention) || incoming.isPrivate)
    ) {
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

    if (this._dataSource === "store") {
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
   * "store": serializes history to Redis + tracks the bot reply ID via msgKey.
   * "db":    updates the pending message row with response, replyModel, and replyMessageId.
   */
  async updateReply(replyMessageId, { replyModel = "" } = {}) {
    const thread = this.current;

    if (this._dataSource === "store") {
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
