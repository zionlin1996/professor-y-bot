/**
 * Tests for each backend's normalizeMessages() — a synchronous translation from
 * the neutral image block format to the backend-specific API format.
 * No API calls are made; backends are instantiated with dummy keys.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

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

const ClaudeBackend = require("../../../src/llm/backends/claude");
const OpenAIBackend = require("../../../src/llm/backends/openai");
const GeminiBackend = require("../../../src/llm/backends/gemini");
const LumoBackend = require("../../../src/llm/backends/lumo");

// ── shared fixtures ───────────────────────────────────────────────────────────

const neutralImage = { type: "image", mediaType: "image/jpeg", data: "base64abc" };
const textBlock = { type: "text", text: "describe this" };
const stringMessage = { role: "user", content: "plain string" };
const arrayMessage = { role: "user", content: [textBlock, neutralImage] };
const imageOnlyMessage = { role: "user", content: [neutralImage] };

// ── Claude ────────────────────────────────────────────────────────────────────

describe("ClaudeBackend.normalizeMessages", () => {
  const backend = new ClaudeBackend();

  it("passes through string content unchanged", () => {
    const [out] = backend.normalizeMessages([stringMessage]);
    assert.equal(out.content, "plain string");
  });

  it("converts neutral image block to Anthropic source format", () => {
    const [out] = backend.normalizeMessages([imageOnlyMessage]);
    const block = out.content[0];
    assert.equal(block.type, "image");
    assert.deepEqual(block.source, {
      type: "base64",
      media_type: "image/jpeg",
      data: "base64abc",
    });
  });

  it("leaves text blocks in array content unchanged", () => {
    const [out] = backend.normalizeMessages([arrayMessage]);
    const textOut = out.content.find((b) => b.type === "text");
    assert.deepEqual(textOut, textBlock);
  });

  it("does not alter the role", () => {
    const [out] = backend.normalizeMessages([arrayMessage]);
    assert.equal(out.role, "user");
  });
});

// ── OpenAI ────────────────────────────────────────────────────────────────────

describe("OpenAIBackend.normalizeMessages", () => {
  const backend = new OpenAIBackend();

  it("passes through string content unchanged", () => {
    const [out] = backend.normalizeMessages([stringMessage]);
    assert.equal(out.content, "plain string");
  });

  it("converts neutral image block to input_image with data URL", () => {
    const [out] = backend.normalizeMessages([imageOnlyMessage]);
    const block = out.content[0];
    assert.equal(block.type, "input_image");
    assert.equal(block.image_url, "data:image/jpeg;base64,base64abc");
  });

  it("converts text blocks to input_text", () => {
    const [out] = backend.normalizeMessages([arrayMessage]);
    const textOut = out.content.find((b) => b.type === "input_text");
    assert.ok(textOut, "expected an input_text block");
    assert.equal(textOut.text, "describe this");
  });

  it("does not alter the role", () => {
    const [out] = backend.normalizeMessages([arrayMessage]);
    assert.equal(out.role, "user");
  });
});

// ── Gemini ────────────────────────────────────────────────────────────────────

describe("GeminiBackend.normalizeMessages", () => {
  const backend = new GeminiBackend();

  it("passes through string content unchanged", () => {
    const [out] = backend.normalizeMessages([stringMessage]);
    assert.equal(out.content, "plain string");
  });

  it("converts neutral image block to inlineData format", () => {
    const [out] = backend.normalizeMessages([imageOnlyMessage]);
    const block = out.content[0];
    assert.deepEqual(block, {
      inlineData: { mimeType: "image/jpeg", data: "base64abc" },
    });
  });

  it("converts text blocks to Gemini { text } format", () => {
    const [out] = backend.normalizeMessages([arrayMessage]);
    const textOut = out.content.find((b) => "text" in b && !b.type);
    assert.ok(textOut, "expected a { text } block");
    assert.equal(textOut.text, "describe this");
  });

  it("does not alter the role", () => {
    const [out] = backend.normalizeMessages([arrayMessage]);
    assert.equal(out.role, "user");
  });
});

// ── Lumo ──────────────────────────────────────────────────────────────────────

describe("LumoBackend.normalizeMessages", () => {
  const backend = new LumoBackend();

  it("passes through string content unchanged", () => {
    const [out] = backend.normalizeMessages([stringMessage]);
    assert.equal(out.content, "plain string");
  });

  it("converts neutral image block to image_url format", () => {
    const [out] = backend.normalizeMessages([imageOnlyMessage]);
    const block = out.content[0];
    assert.equal(block.type, "image_url");
    assert.deepEqual(block.image_url, { url: "data:image/jpeg;base64,base64abc" });
  });

  it("keeps text blocks as { type: 'text', text } (unchanged)", () => {
    const [out] = backend.normalizeMessages([arrayMessage]);
    const textOut = out.content.find((b) => b.type === "text");
    assert.ok(textOut, "expected a text block");
    assert.equal(textOut.text, "describe this");
  });

  it("does not alter the role", () => {
    const [out] = backend.normalizeMessages([arrayMessage]);
    assert.equal(out.role, "user");
  });
});

// ── cross-backend: neutral format is never leaked ─────────────────────────────

describe("all backends — neutral format not leaked", () => {
  const backends = [
    new ClaudeBackend(),
    new OpenAIBackend(),
    new GeminiBackend(),
    new LumoBackend(),
  ];

  for (const backend of backends) {
    const name = backend.constructor.name;

    it(`${name}: no 'mediaType' key remains in output (neutral key is transformed)`, () => {
      const [out] = backend.normalizeMessages([imageOnlyMessage]);
      const json = JSON.stringify(out);
      assert.ok(
        !json.includes('"mediaType"'),
        `${name} output still contains 'mediaType': ${json}`,
      );
    });
  }
});
