const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Prompt = require("../../src/dto/Prompt");

function makePrompt(overrides = {}) {
  return new Prompt({
    text: "hello",
    content: "hello",
    attachment: null,
    userId: "42",
    username: "alice",
    messageId: "1",
    ...overrides,
  });
}

describe("isEmpty", () => {
  it("false when content is a non-empty string", () => {
    assert.equal(makePrompt({ content: "text" }).isEmpty, false);
  });

  it("false when content is an array (multimodal)", () => {
    assert.equal(
      makePrompt({ content: [{ type: "text", text: "hi" }] }).isEmpty,
      false,
    );
  });

  it("false when attachment is set even if content is falsy", () => {
    assert.equal(
      makePrompt({ content: null, attachment: { fileId: "f1", mediaType: "image/jpeg" } }).isEmpty,
      false,
    );
  });

  it("true when both content and attachment are null", () => {
    assert.equal(makePrompt({ content: null, attachment: null }).isEmpty, true);
  });

  it("true when content is empty string and attachment is null", () => {
    assert.equal(makePrompt({ content: "", attachment: null }).isEmpty, true);
  });
});

describe("constructor fields", () => {
  it("stores all fields as-is", () => {
    const p = new Prompt({
      text: "clean text",
      content: "prefixed text",
      attachment: { fileId: "x", mediaType: "image/png" },
      userId: "99",
      username: "bob",
      messageId: "55",
    });
    assert.equal(p.text, "clean text");
    assert.equal(p.content, "prefixed text");
    assert.deepEqual(p.attachment, { fileId: "x", mediaType: "image/png" });
    assert.equal(p.userId, "99");
    assert.equal(p.username, "bob");
    assert.equal(p.messageId, "55");
  });
});
