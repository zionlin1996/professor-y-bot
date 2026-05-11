const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// All backends require their API keys at construction time.
// Set dummy values before requiring LLMService so _initBackend(claude) in
// the constructor can succeed without a real key.
before(() => {
  process.env.ANTHROPIC_API_KEY = "test-anthropic";
  process.env.OPENAI_API_KEY = "test-openai";
  process.env.GEMINI_API_KEY = "test-gemini";
  process.env.LUMO_API_KEY = "test-lumo";
});

after(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.LUMO_API_KEY;
});

const LLMService = require("../../src/services/LLMService");

function makeStore(storedJson = null) {
  return {
    get: async () => storedJson,
    set: async () => {},
  };
}

// Reset the shared static cache before each test to avoid cross-test pollution.
beforeEach(() => {
  LLMService.modelListCache = {};
});

// ── providerInfo ──────────────────────────────────────────────────────────────

describe("providerInfo", () => {
  it("returns 'backendName / modelName'", () => {
    const llm = new LLMService({ store: makeStore() });
    const info = llm.providerInfo();
    assert.ok(info.includes("/"), `expected '/' separator, got: ${info}`);
    const [backend, model] = info.split(" / ");
    assert.ok(backend.length > 0);
    assert.ok(model.length > 0);
  });

  it("defaults to claude backend", () => {
    const llm = new LLMService({ store: makeStore() });
    assert.ok(llm.providerInfo().startsWith("claude /"));
  });
});

// ── availableBackends / models / modelAt ──────────────────────────────────────

describe("availableBackends", () => {
  it("returns empty array when modelListCache is empty", () => {
    const llm = new LLMService({ store: makeStore() });
    assert.deepEqual(llm.availableBackends(), []);
  });

  it("returns backend names present in modelListCache", () => {
    const llm = new LLMService({ store: makeStore() });
    LLMService.modelListCache = { claude: ["claude-3"], openai: ["gpt-4o"] };
    assert.deepEqual(llm.availableBackends().sort(), ["claude", "openai"]);
  });
});

describe("models", () => {
  it("returns the cached model list for a backend", () => {
    const llm = new LLMService({ store: makeStore() });
    LLMService.modelListCache = { gemini: ["gemini-pro", "gemini-flash"] };
    assert.deepEqual(llm.models("gemini"), ["gemini-pro", "gemini-flash"]);
  });

  it("returns empty array for unknown backend", () => {
    const llm = new LLMService({ store: makeStore() });
    assert.deepEqual(llm.models("unknown"), []);
  });
});

describe("modelAt", () => {
  it("returns the model at the given index", () => {
    const llm = new LLMService({ store: makeStore() });
    LLMService.modelListCache = { openai: ["gpt-4o", "gpt-4-turbo", "o3"] };
    assert.equal(llm.modelAt("openai", 0), "gpt-4o");
    assert.equal(llm.modelAt("openai", 2), "o3");
  });

  it("returns undefined for out-of-range index", () => {
    const llm = new LLMService({ store: makeStore() });
    LLMService.modelListCache = { openai: ["gpt-4o"] };
    assert.equal(llm.modelAt("openai", 99), undefined);
  });

  it("returns undefined for unknown backend", () => {
    const llm = new LLMService({ store: makeStore() });
    assert.equal(llm.modelAt("nope", 0), undefined);
  });
});

// ── _initBackend ──────────────────────────────────────────────────────────────

describe("_initBackend", () => {
  it("throws for an unknown backend name", () => {
    const llm = new LLMService({ store: makeStore() });
    assert.throws(
      () => llm._initBackend("nonexistent", "model"),
      /Unknown backend: "nonexistent"/,
    );
  });

  it("sets backendName and backend.model", () => {
    const llm = new LLMService({ store: makeStore() });
    llm._initBackend("claude", "claude-opus-4-7");
    assert.equal(llm.backendName, "claude");
    assert.equal(llm.backend.model, "claude-opus-4-7");
  });
});

// ── init ──────────────────────────────────────────────────────────────────────

describe("init", () => {
  it("applies stored backend+model from Redis", async () => {
    const stored = JSON.stringify({ backend: "openai", model: "gpt-4o" });
    const llm = new LLMService({ store: makeStore(stored) });
    await llm.init();
    assert.equal(llm.backendName, "openai");
    assert.equal(llm.backend.model, "gpt-4o");
  });

  it("keeps default when Redis returns null", async () => {
    const llm = new LLMService({ store: makeStore(null) });
    const defaultBackend = llm.backendName;
    await llm.init();
    assert.equal(llm.backendName, defaultBackend);
  });

  it("keeps default when stored JSON is corrupted", async () => {
    const llm = new LLMService({ store: makeStore("not-json{{{") });
    const defaultBackend = llm.backendName;
    await llm.init();
    assert.equal(llm.backendName, defaultBackend);
  });

  it("keeps default when store is absent (null)", async () => {
    const llm = new LLMService({ store: null });
    const defaultBackend = llm.backendName;
    await llm.init();
    assert.equal(llm.backendName, defaultBackend);
  });
});

// ── setActiveModel ────────────────────────────────────────────────────────────

describe("setActiveModel", () => {
  it("switches the active backend and model", async () => {
    const llm = new LLMService({ store: makeStore() });
    await llm.setActiveModel("openai", "gpt-4o-mini");
    assert.equal(llm.backendName, "openai");
    assert.equal(llm.backend.model, "gpt-4o-mini");
  });

  it("persists the selection to Redis", async () => {
    const setCalls = [];
    const store = { get: async () => null, set: async (...args) => setCalls.push(args) };
    const llm = new LLMService({ store });
    await llm.setActiveModel("claude", "claude-sonnet-4-6");
    assert.ok(setCalls.length > 0, "expected store.set to be called");
    const payload = JSON.parse(setCalls[0][1]);
    assert.equal(payload.backend, "claude");
    assert.equal(payload.model, "claude-sonnet-4-6");
  });
});
