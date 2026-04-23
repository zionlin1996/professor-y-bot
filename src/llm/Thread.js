const { randomBytes } = require("crypto");
const store = require("../libs/store");
const { getDb } = require("../libs/db");

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

class Thread {
  // In-memory index: messageId → threadId, shared across all instances.
  // Avoids a Redis round-trip for the msg→thread lookup on warm paths.
  static messageMap = new Map();

  constructor(id, history = [], stealth = false) {
    this.id = id;
    this.history = history;
    this.stealth = stealth;
    this._pendingMessageId = null;
  }

  // Create a new empty thread and initialise its Redis entry.
  // stealth=true: Redis-only, no DB writes (future stealth mode).
  static async create({ chatId, userId, stealth = false } = {}) {
    const id = randomBytes(16).toString("hex");
    await store.set(threadKey(id), "[]");
    if (!stealth) {
      const db = getDb();
      if (db) {
        await db.thread
          .create({ data: { id, chatId: String(chatId ?? ""), userId: String(userId ?? "") } })
          .catch((err) => console.error("[Thread.create] DB error:", err));
      }
    }
    return new Thread(id, [], stealth);
  }

  // Load an existing thread by ID, restoring history from Redis if available.
  static async load(threadId, { stealth = false } = {}) {
    const raw = await store.get(threadKey(threadId));
    return new Thread(threadId, raw ? JSON.parse(raw) : [], stealth);
  }

  // Resolve a Telegram message ID to the Thread it belongs to.
  // Checks in-memory messageMap first, then falls back to Redis.
  static async resolve(messageId, { stealth = false } = {}) {
    const threadId =
      Thread.messageMap.get(messageId) ?? (await store.get(msgKey(messageId)));
    if (!threadId) return null;
    Thread.messageMap.set(messageId, threadId); // warm in-memory cache
    return Thread.load(threadId, { stealth });
  }

  // Append a message to history, trimming oldest entries when over the cap.
  append(role, content) {
    this.history.push({ role, content });
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
  }

  // Append a user message to history and immediately persist it to DB.
  // cleanContent: raw user input (no sender prefix, no inline command tokens).
  // prefixedContent: the LLM-context version ("@name: ...") stored in history.
  // attachment: { fileId, mediaType } | null
  // Call this before the LLM — guarantees a DB record even if the LLM fails.
  async appendMessage(cleanContent, prefixedContent, { userId = "", attachment = null } = {}) {
    this.append("user", prefixedContent);

    if (this.stealth) return;
    const db = getDb();
    if (!db) return;
    const record = await db.message
      .create({
        data: {
          threadId: this.id,
          userId: String(userId),
          content: String(cleanContent),
          attachmentFileId: attachment?.fileId ?? null,
          attachmentMediaType: attachment?.mediaType ?? null,
        },
      })
      .catch((err) => { console.error("[Thread.appendMessage] DB error:", err); return null; });
    this._pendingMessageId = record?.id ?? null;
  }

  // Persist to all active storage layers.
  // Redis: always (history with images stripped).
  // DB: updates the pending message row created by appendMessage() with the LLM response.
  async save({ replyModel = "" } = {}) {
    await store.set(threadKey(this.id), JSON.stringify(stripImages(this.history)));

    if (this.stealth) return;
    const db = getDb();
    if (!db) return;
    if (!this._pendingMessageId) return;
    const last = this.history[this.history.length - 1];
    if (last?.role !== "assistant") return;
    db.message
      .update({
        where: { id: this._pendingMessageId },
        data: { response: String(last.content), replyModel: String(replyModel) },
      })
      .then(() => { this._pendingMessageId = null; })
      .catch((err) => console.error("[Thread.save] DB error:", err));
  }

  // Returns the public archive URL for this thread.
  toPublicUrl() {
    const base = process.env.EXTERNAL_URL || "http://localhost";
    return `${base}/archive/${this.id}`;
  }

  // Associate a Telegram message ID with this thread (both directions).
  async trackMessage(messageId) {
    Thread.messageMap.set(messageId, this.id);
    await store.set(msgKey(messageId), this.id);
  }


}

module.exports = Thread;
