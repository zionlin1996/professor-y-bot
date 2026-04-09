const { v4: uuidv4 } = require("uuid");
const { randomBytes } = require("crypto");
const store = require("../libs/store");

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

  constructor(id, history = []) {
    this.id = id;
    this.history = history;
  }

  // Create a new empty thread and initialise its Redis entry.
  static async create() {
    const id = uuidv4();
    await store.set(threadKey(id), "[]");
    return new Thread(id, []);
  }

  // Load an existing thread by ID, restoring history from Redis if available.
  static async load(threadId) {
    const raw = await store.get(threadKey(threadId));
    return new Thread(threadId, raw ? JSON.parse(raw) : []);
  }

  // Resolve a Telegram message ID to the Thread it belongs to.
  // Checks in-memory messageMap first, then falls back to Redis.
  static async resolve(messageId) {
    const threadId =
      Thread.messageMap.get(messageId) ?? (await store.get(msgKey(messageId)));
    if (!threadId) return null;
    Thread.messageMap.set(messageId, threadId); // warm in-memory cache
    return Thread.load(threadId);
  }

  // Append a message to history, trimming oldest entries when over the cap.
  append(role, content) {
    this.history.push({ role, content });
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
  }

  // Persist current history to Redis (images stripped to keep payloads small).
  async save() {
    await store.set(threadKey(this.id), JSON.stringify(stripImages(this.history)));
  }

  // Associate a Telegram message ID with this thread (both directions).
  async trackMessage(messageId) {
    Thread.messageMap.set(messageId, this.id);
    await store.set(msgKey(messageId), this.id);
  }

  // Generate a cryptographically random archive token and persist the hash → threadId mapping.
  // Returns the 32-char hex token.
  async archive() {
    const hash = randomBytes(16).toString("hex");
    await store.set(`archive:${hash}`, this.id);
    return hash;
  }

  // Resolve an archive hash to its Thread. Returns null if the hash is unknown or expired.
  static async resolveArchive(hash) {
    const threadId = await store.get(`archive:${hash}`);
    if (!threadId) return null;
    return Thread.load(threadId);
  }
}

module.exports = Thread;
