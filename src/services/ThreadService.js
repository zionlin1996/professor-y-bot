const { randomBytes } = require("crypto");

const MAX_HISTORY = 20;
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
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
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
  constructor(incoming, { store, db } = {}) {
    this._incoming = incoming;
    this._store = store;
    this._db = db;
    this._pendingMessageId = null;
    /** The resolved/created Thread for this request. Set by resolveOrCreate(). */
    this.thread = null;
  }

  // ---------------------------------------------------------------------------
  // User info (DB fetch owned here, not by the DTO)
  // ---------------------------------------------------------------------------

  async _fetchUserInfo(userId) {
    const defaults = { permissionLevel: null, stealth: false };
    if (!this._db || !userId) return defaults;
    try {
      const profile = await this._db.userProfile.findUnique({
        where: { id: String(userId) },
      });
      return {
        permissionLevel: profile?.permissionLevel ?? null,
        stealth: profile?.stealthMode ?? false,
      };
    } catch {
      return defaults;
    }
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
   *   { userMessage }    — proceed; thread is set on this.thread
   *   null               — group message with no @mention and no tracked reply; ignore
   *   { reject, reason } — private chat permission denied; send reason and stop
   */
  async resolveOrCreate() {
    const incoming = this._incoming;
    const { stealth, permissionLevel } = await this._fetchUserInfo(
      incoming.userId,
    );

    let thread;

    if (incoming.isGroup) {
      if (incoming.replyToId) {
        thread = await this.resolve(incoming.replyToId, { stealth });
        if (thread) {
          this.thread = thread;
          return { userMessage: incoming.text };
        }
      }
      if (incoming.isMention) {
        thread = await this.create({
          chatId: incoming.chatId,
          userId: incoming.userId,
          stealth,
        });
        this.thread = thread;
        return { userMessage: incoming.quotedPrompt };
      }
      return null;
    }

    // Private chat
    if (permissionLevel === null || permissionLevel === 1) {
      return {
        reject: true,
        reason: "Sorry, private chat access is restricted.",
      };
    }
    if (incoming.replyToId) {
      thread = await this.resolve(incoming.replyToId, { stealth });
    }
    if (!thread) {
      thread = await this.create({
        chatId: incoming.chatId,
        userId: incoming.userId,
        stealth,
      });
    }
    this.thread = thread;
    return { userMessage: incoming.text };
  }

  // ---------------------------------------------------------------------------
  // Message operations — all use this.thread set by resolveOrCreate()
  // ---------------------------------------------------------------------------

  /**
   * Append the user message to history and persist a DB record before calling the LLM.
   * cleanContent: raw user input (no sender prefix, no inline command tokens).
   * prefixedContent: the LLM-context version ("@name: ...") stored in history.
   */
  async appendMessage(
    cleanContent,
    prefixedContent,
    { userId = "", attachment = null } = {},
  ) {
    const thread = this.thread;
    thread.append("user", prefixedContent);

    if (thread.stealth || !this._db) return;
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
    const record = await this._db.message.create({
      data: {
        threadId: thread.id,
        userId: finalUserId,
        content: String(cleanContent),
        attachmentFileId: attachment?.fileId ?? null,
        attachmentMediaType: attachment?.mediaType ?? null,
      },
    });
    this._pendingMessageId = record.id;
  }

  /**
   * Persist thread history to Redis and update the pending DB message row
   * with the LLM response.
   */
  async save({ replyModel = "" } = {}) {
    const thread = this.thread;
    await this._store.set(
      threadKey(thread.id),
      JSON.stringify(stripImages(thread.history)),
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
    await this._store.set(msgKey(messageId), this.thread.id);
  }

  /** Track multiple message IDs in parallel. */
  async trackMessages(...messageIds) {
    await Promise.all(messageIds.map((id) => this.trackMessage(id)));
  }
}

module.exports = { ThreadService, Thread };
