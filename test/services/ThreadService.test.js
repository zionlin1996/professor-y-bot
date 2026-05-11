const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const ThreadService = require("../../src/services/ThreadService");

// ── stub factories ────────────────────────────────────────────────────────────

function makeStore(overrides = {}) {
  const calls = [];
  return {
    calls,
    get: async (key) => { calls.push({ method: "get", key }); return overrides[key] ?? null; },
    set: async (key, value) => { calls.push({ method: "set", key, value }); },
  };
}

function makeDb(overrides = {}) {
  const calls = [];
  return {
    calls,
    thread: {
      create: async (opts) => { calls.push({ method: "thread.create", opts }); return {}; },
    },
    message: {
      create: async (opts) => {
        calls.push({ method: "message.create", opts });
        return { id: "msg-db-id-1" };
      },
      update: async (opts) => { calls.push({ method: "message.update", opts }); },
      findMany: async (opts) => {
        calls.push({ method: "message.findMany", opts });
        return overrides.messages ?? [];
      },
      findFirst: async (opts) => {
        calls.push({ method: "message.findFirst", opts });
        return overrides.firstMessage ?? null;
      },
    },
  };
}

function makeService({ store, db, user = null } = {}) {
  return new ThreadService({ store: store ?? makeStore(), db: db ?? makeDb(), user });
}

// ── create ────────────────────────────────────────────────────────────────────

describe("ThreadService.create — non-ephemeral", () => {
  it("calls db.thread.create", async () => {
    const db = makeDb();
    const s = makeService({ db });
    await s.create({ chatId: "100" });
    assert.ok(db.calls.some((c) => c.method === "thread.create"));
  });

  it("does not call store.set for thread history", async () => {
    const store = makeStore();
    const s = makeService({ store });
    await s.create({ chatId: "100" });
    const threadSets = store.calls.filter(
      (c) => c.method === "set" && c.key.startsWith("thread:"),
    );
    assert.equal(threadSets.length, 0);
  });

  it("returns a Thread with empty history and ephemeral=false", async () => {
    const s = makeService();
    const t = await s.create({ chatId: "100" });
    assert.equal(t.history.length, 0);
    assert.equal(t.ephemeral, false);
  });
});

describe("ThreadService.create — ephemeral", () => {
  it("calls store.set with empty history JSON", async () => {
    const store = makeStore();
    const s = makeService({ store });
    await s.create({ chatId: "100", ephemeral: true });
    const threadSet = store.calls.find((c) => c.method === "set" && c.key.startsWith("thread:"));
    assert.ok(threadSet, "expected store.set call for thread key");
    assert.equal(threadSet.value, "[]");
  });

  it("returns a Thread with ephemeral=true", async () => {
    const s = makeService();
    const t = await s.create({ chatId: "100", ephemeral: true });
    assert.equal(t.ephemeral, true);
  });
});

// ── load ──────────────────────────────────────────────────────────────────────

describe("ThreadService.load", () => {
  it("builds user+assistant pairs from DB messages", async () => {
    const db = makeDb({
      messages: [
        { content: "hello", response: "hi there", attachmentFileId: null },
        { content: "what is 2+2", response: "4", attachmentFileId: null },
      ],
    });
    const s = makeService({ db });
    const t = await s.load("thread-abc");
    assert.equal(t.history.length, 4); // 2 user + 2 assistant
    assert.equal(t.history[0].role, "user");
    assert.equal(t.history[0].content, "hello");
    assert.equal(t.history[1].role, "assistant");
    assert.equal(t.history[1].content, "hi there");
  });

  it("omits assistant turn when response is absent", async () => {
    const db = makeDb({
      messages: [{ content: "hello", response: null, attachmentFileId: null }],
    });
    const s = makeService({ db });
    const t = await s.load("thread-abc");
    assert.equal(t.history.length, 1);
    assert.equal(t.history[0].role, "user");
  });

  it("uses '[image]' placeholder for image-only messages", async () => {
    const db = makeDb({
      messages: [{ content: "", response: null, attachmentFileId: "file-123" }],
    });
    const s = makeService({ db });
    const t = await s.load("thread-abc");
    assert.equal(t.history[0].content, "[image]");
  });

  it("uses '[message]' placeholder when content empty and no attachment", async () => {
    const db = makeDb({
      messages: [{ content: "", response: null, attachmentFileId: null }],
    });
    const s = makeService({ db });
    const t = await s.load("thread-abc");
    assert.equal(t.history[0].content, "[message]");
  });
});

// ── resolve ───────────────────────────────────────────────────────────────────

describe("ThreadService.resolve — DB path", () => {
  it("returns a Thread when db.message.findFirst matches", async () => {
    const db = makeDb({
      firstMessage: { threadId: "thread-xyz" },
      messages: [{ content: "hi", response: "hello", attachmentFileId: null }],
    });
    const s = makeService({ db });
    const t = await s.resolve("42");
    assert.ok(t !== null);
    assert.equal(t.id, "thread-xyz");
  });

  it("returns null when db.message.findFirst returns nothing", async () => {
    const db = makeDb({ firstMessage: null });
    const store = makeStore();
    const s = new ThreadService({ store, db, user: null });
    const t = await s.resolve("999");
    assert.equal(t, null);
  });
});

describe("ThreadService.resolve — Redis ephemeral path", () => {
  it("returns null when db is null and Redis has no mapping", async () => {
    const store = makeStore({});
    const s = new ThreadService({ store, db: null, user: null });
    const t = await s.resolve("42");
    assert.equal(t, null);
  });

  it("returns an ephemeral Thread from Redis when mapping exists", async () => {
    const history = [{ role: "user", content: "cached" }];
    const store = makeStore({
      "msg:42": "thread-redis-abc",
      "thread:thread-redis-abc": JSON.stringify(history),
    });
    const s = new ThreadService({ store, db: null, user: null });
    const t = await s.resolve("42");
    assert.ok(t !== null);
    assert.equal(t.id, "thread-redis-abc");
    assert.equal(t.ephemeral, true);
    assert.deepEqual(t.history, history);
  });
});

// ── appendPrompt ──────────────────────────────────────────────────────────────

describe("ThreadService.appendPrompt — ephemeral thread", () => {
  it("calls store.set for msgKey, skips db.message.create", async () => {
    const store = makeStore();
    const db = makeDb();
    const s = makeService({ store, db });
    s.current = await s.create({ chatId: "100", ephemeral: true });

    const prompt = { content: "hi", text: "hi", userId: "1", messageId: "msg-1", attachment: null };
    await s.appendPrompt(prompt);

    const msgSet = store.calls.find((c) => c.method === "set" && c.key === "msg:msg-1");
    assert.ok(msgSet, "expected store.set for msg key");
    assert.ok(!db.calls.some((c) => c.method === "message.create"), "should not write to DB");
  });

  it("appends the message to thread history", async () => {
    const s = makeService();
    s.current = await s.create({ chatId: "100", ephemeral: true });
    await s.appendPrompt({ content: "hello", text: "hello", userId: "1", messageId: "m1", attachment: null });
    assert.equal(s.current.history.length, 1);
    assert.equal(s.current.history[0].content, "hello");
  });
});

describe("ThreadService.appendPrompt — regular thread", () => {
  it("calls db.message.create with correct fields", async () => {
    const db = makeDb();
    const s = makeService({ db });
    s.current = await s.create({ chatId: "100" });

    const prompt = {
      content: "what is the weather?",
      text: "what is the weather?",
      userId: "42",
      messageId: "tg-101",
      attachment: null,
    };
    await s.appendPrompt(prompt);

    const createCall = db.calls.find((c) => c.method === "message.create");
    assert.ok(createCall);
    assert.equal(createCall.opts.data.userId, "42");
    assert.equal(createCall.opts.data.messageId, "tg-101");
    assert.equal(createCall.opts.data.content, "what is the weather?");
  });

  it("stores attachment metadata when present", async () => {
    const db = makeDb();
    const s = makeService({ db });
    s.current = await s.create({ chatId: "100" });

    await s.appendPrompt({
      content: "look at this",
      text: "look at this",
      userId: "1",
      messageId: "m2",
      attachment: { fileId: "photo-123", mediaType: "image/jpeg" },
    });

    const createCall = db.calls.find((c) => c.method === "message.create");
    assert.equal(createCall.opts.data.attachmentFileId, "photo-123");
    assert.equal(createCall.opts.data.attachmentMediaType, "image/jpeg");
  });
});

// ── updateReply ───────────────────────────────────────────────────────────────

describe("ThreadService.updateReply — ephemeral thread", () => {
  it("serializes history to Redis and tracks reply msgKey", async () => {
    const store = makeStore();
    const db = makeDb();
    const s = makeService({ store, db });
    s.current = await s.create({ chatId: "100", ephemeral: true });
    s.current.append("user", "hi");
    s.current.append("assistant", "hello");

    await s.updateReply("bot-reply-99", { replyModel: "claude-haiku" });

    const threadSet = store.calls.find(
      (c) => c.method === "set" && c.key.startsWith("thread:"),
    );
    assert.ok(threadSet, "expected store.set for thread history");

    const replySet = store.calls.find((c) => c.method === "set" && c.key === "msg:bot-reply-99");
    assert.ok(replySet, "expected store.set for reply msgKey");
  });
});

describe("ThreadService.updateReply — regular thread", () => {
  it("calls db.message.update with response and replyModel", async () => {
    const db = makeDb();
    const s = makeService({ db });
    s.current = await s.create({ chatId: "100" });
    // Simulate appendPrompt setting _pendingMessageId
    await s.appendPrompt({ content: "q", text: "q", userId: "1", messageId: "m1", attachment: null });
    s.current.append("assistant", "the answer is 42");

    await s.updateReply("bot-msg-55", { replyModel: "gpt-4o" });

    const updateCall = db.calls.find((c) => c.method === "message.update");
    assert.ok(updateCall, "expected db.message.update call");
    assert.equal(updateCall.opts.data.response, "the answer is 42");
    assert.equal(updateCall.opts.data.replyModel, "gpt-4o");
    assert.equal(updateCall.opts.data.replyMessageId, "bot-msg-55");
  });

  it("is a no-op when _pendingMessageId is not set", async () => {
    const db = makeDb();
    const s = makeService({ db });
    s.current = await s.create({ chatId: "100" });
    s.current.append("assistant", "orphan reply");

    await s.updateReply("bot-msg-56", {});

    assert.ok(!db.calls.some((c) => c.method === "message.update"));
  });
});
