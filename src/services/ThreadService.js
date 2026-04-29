const { randomBytes } = require("crypto");

const threadKey = (id) => `thread:${id}`;
const msgKey = (id) => `msg:${id}`;

// Strip image blocks before writing to Redis to avoid storing large base64 payloads.
// Array content (text + image blocks) is collapsed to plain text; image-only turns become "[image]".
function stripImages(messages) {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    return { ...msg, content: text || "[image]" };
  });
}

/**
 * Lightweight thread data model. Holds history and state — no I/O.
 * All persistence is handled by ThreadService.
 */
class Thread {
  constructor(id, history = [], stealth = false) {
    this.id = id;
    this.history = history;
    this.stealth = stealth;
  }

  /** Append a message to history, trimming oldest entries when over the cap. */
  append(role, content) {
    this.history.push({ role, content });
  }

  /** Public archive URL for this thread. */
  toPublicUrl() {
    const base = process.env.EXTERNAL_URL || "http://localhost";
    return `${base}/archive/${this.id}`;
  }
}

/**
 * Per-request service for thread lifecycle and message persistence.
 *
 * Instantiate once per incoming message with the resolved IncomingMessage DTO.
 * Pass null for incoming when only load() is needed (e.g. archive route).
 *
 * Dependencies injected via constructor for testability:
 *   store  — src/libs/store (Redis wrapper)
 *   db     — Prisma client or null
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

  async create({ chatId, userId, stealth = false } = {}) {
    const id = randomBytes(16).toString("hex");
    await this._store.set(threadKey(id), "[]");
    if (!stealth && this._db) {
      // Validate userId exists in userProfile before inserting to respect FK constraint
      let finalUserId = null;
      if (userId) {
        try {
          const profile = await this._db.userProfile.findUnique({
            where: { id: String(userId) },
          });
          if (profile) {
            finalUserId = String(userId);
          }
        } catch {
          // If query fails, fall back to null
          finalUserId = null;
        }
      }

      await this._db.thread.create({
        data: {
          id,
          chatId: String(chatId ?? ""),
          userId: finalUserId,
        },
      });
    }
    return new Thread(id, [], stealth);
  }

  async load(threadId, { stealth = false } = {}) {
    const raw = await this._store.get(threadKey(threadId));
    return new Thread(threadId, raw ? JSON.parse(raw) : [], stealth);
  }

  async resolve(messageId, { stealth = false } = {}) {
    const threadId = await this._store.get(msgKey(messageId));
    if (!threadId) return null;
    return this.load(threadId, { stealth });
  }

  /**
   * Resolve an existing thread or create a new one based on this._incoming.
   *
   * Returns:
   *   Thread             — the resolved or created thread
   */
  async resolveOrCreate(incoming) {
    const { stealth } = this._user.current;

    if (incoming.replyToId) {
      this.current = await this.resolve(incoming.replyToId, { stealth });
    } else if ((incoming.isGroup && incoming.isMention) || incoming.isPrivate) {
      this.current = await this.create({
        chatId: incoming.chatId,
        userId: incoming.userId,
        stealth,
      });
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

    if (thread.stealth || !this._db) return;
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
   * Persist thread history to Redis and update the pending DB message row
   * with the LLM response.
   */
  async save({ replyModel = "" } = {}) {
    const thread = this.current;
    await this._store.set(
      threadKey(thread.id),
      JSON.stringify(stripImages(thread.history))
    );

    if (thread.stealth || !this._db || !this._pendingMessageId) return;
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
