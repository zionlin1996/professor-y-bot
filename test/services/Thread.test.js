/**
 * Tests for the Thread data class (inner class of ThreadService, not directly exported).
 * Thread instances are obtained via ThreadService.create() with stub deps.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const ThreadService = require("../../src/services/ThreadService");

function makeService({ ephemeral = false } = {}) {
  const db = { thread: { create: async () => {} } };
  const store = { set: async () => {} };
  return { service: new ThreadService({ store, db, user: null }), db, store };
}

async function newThread(ephemeral = false) {
  const { service } = makeService();
  return service.create({ chatId: "100", ephemeral });
}

// ── append ────────────────────────────────────────────────────────────────────

describe("Thread.append", () => {
  it("adds a message to history", async () => {
    const t = await newThread();
    t.append("user", "hello");
    assert.equal(t.history.length, 1);
    assert.deepEqual(t.history[0], { role: "user", content: "hello" });
  });

  it("accumulates messages in order", async () => {
    const t = await newThread();
    t.append("user", "ping");
    t.append("assistant", "pong");
    assert.equal(t.history.length, 2);
    assert.equal(t.history[0].role, "user");
    assert.equal(t.history[1].role, "assistant");
  });

  it("stores array content (multimodal) as-is", async () => {
    const t = await newThread();
    const content = [{ type: "text", text: "hi" }, { type: "image", mediaType: "image/jpeg", data: "abc" }];
    t.append("user", content);
    assert.deepEqual(t.history[0].content, content);
  });
});

// ── serialize ─────────────────────────────────────────────────────────────────

describe("Thread.serialize", () => {
  it("passes through string content unchanged", async () => {
    const t = await newThread();
    t.append("user", "plain text");
    t.append("assistant", "reply");
    const s = t.serialize();
    assert.equal(s[0].content, "plain text");
    assert.equal(s[1].content, "reply");
  });

  it("strips image blocks — collapses to text only", async () => {
    const t = await newThread();
    t.append("user", [
      { type: "text", text: "describe this" },
      { type: "image", mediaType: "image/jpeg", data: "base64payload" },
    ]);
    const s = t.serialize();
    assert.equal(typeof s[0].content, "string");
    assert.equal(s[0].content, "describe this");
    assert.ok(!s[0].content.includes("base64payload"));
  });

  it("image-only content becomes '[image]'", async () => {
    const t = await newThread();
    t.append("user", [
      { type: "image", mediaType: "image/png", data: "..." },
    ]);
    const s = t.serialize();
    assert.equal(s[0].content, "[image]");
  });

  it("preserves role on serialized entries", async () => {
    const t = await newThread();
    t.append("user", [{ type: "text", text: "hi" }, { type: "image", data: "x", mediaType: "image/png" }]);
    t.append("assistant", "sure");
    const s = t.serialize();
    assert.equal(s[0].role, "user");
    assert.equal(s[1].role, "assistant");
  });

  it("does not mutate the original history", async () => {
    const t = await newThread();
    const content = [{ type: "text", text: "hi" }, { type: "image", data: "x", mediaType: "image/png" }];
    t.append("user", content);
    t.serialize();
    assert.deepEqual(t.history[0].content, content);
  });
});

// ── toPublicUrl ───────────────────────────────────────────────────────────────

describe("Thread.toPublicUrl", () => {
  before(() => { process.env.EXTERNAL_URL = "https://bot.example.com"; });
  after(() => { delete process.env.EXTERNAL_URL; });

  it("returns EXTERNAL_URL/archive/<id>", async () => {
    const t = await newThread();
    assert.equal(t.toPublicUrl(), `https://bot.example.com/archive/${t.id}`);
  });

  it("uses localhost fallback when EXTERNAL_URL is unset", async () => {
    delete process.env.EXTERNAL_URL;
    const t = await newThread();
    assert.ok(t.toPublicUrl().startsWith("http://localhost/archive/"));
  });
});

// ── ephemeral flag ────────────────────────────────────────────────────────────

describe("Thread.ephemeral", () => {
  it("is false for non-ephemeral threads", async () => {
    const t = await newThread(false);
    assert.equal(t.ephemeral, false);
  });

  it("is true for ephemeral threads", async () => {
    const { service } = makeService();
    const store = { set: async () => {} };
    const db = { thread: { create: async () => {} } };
    const s = new ThreadService({ store, db, user: null });
    const t = await s.create({ chatId: "100", ephemeral: true });
    assert.equal(t.ephemeral, true);
  });
});

// ── id ────────────────────────────────────────────────────────────────────────

describe("Thread.id", () => {
  it("is a 32-character hex string", async () => {
    const t = await newThread();
    assert.match(t.id, /^[0-9a-f]{32}$/);
  });

  it("is unique across threads", async () => {
    const t1 = await newThread();
    const t2 = await newThread();
    assert.notEqual(t1.id, t2.id);
  });
});
