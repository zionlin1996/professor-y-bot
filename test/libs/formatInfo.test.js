const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const formatInfo = require("../../src/libs/formatInfo");

const DIVIDER = "─────────────────────";

function makeStubs({ model = "claude/claude-haiku-4-5", id = "abc123", url = "https://example.com/archive/abc123" } = {}) {
  const llm = { providerInfo: () => model };
  const thread = { id, toPublicUrl: () => url };
  return { llm, thread };
}

describe("formatInfo — HTML format (default)", () => {
  it("includes both dividers", () => {
    const { llm, thread } = makeStubs();
    const out = formatInfo(llm, thread);
    assert.equal(out.split(DIVIDER).length - 1, 2);
  });

  it("includes model string", () => {
    const { llm, thread } = makeStubs({ model: "openai/gpt-4o" });
    const out = formatInfo(llm, thread);
    assert.ok(out.includes("Model: openai/gpt-4o"), `output: ${out}`);
  });

  it("includes thread id", () => {
    const { llm, thread } = makeStubs({ id: "deadbeef" });
    const out = formatInfo(llm, thread);
    assert.ok(out.includes("Thread Id: deadbeef"), `output: ${out}`);
  });

  it("wraps archive url in <a> tag", () => {
    const url = "https://example.com/archive/abc123";
    const { llm, thread } = makeStubs({ url });
    const out = formatInfo(llm, thread);
    assert.ok(
      out.includes(`<a href="${url}">${url}</a>`),
      `output: ${out}`,
    );
  });

  it("starts with two blank lines (separates from LLM reply)", () => {
    const { llm, thread } = makeStubs();
    const out = formatInfo(llm, thread);
    assert.ok(out.startsWith("\n\n"), `output starts with: ${JSON.stringify(out.slice(0, 10))}`);
  });
});

describe("formatInfo — plain format", () => {
  it("uses raw url (no <a> tag)", () => {
    const url = "https://example.com/archive/plain";
    const { llm, thread } = makeStubs({ url });
    const out = formatInfo(llm, thread, { format: "plain" });
    assert.ok(out.includes(`Link: ${url}`), `output: ${out}`);
    assert.ok(!out.includes("<a"), `output should not have <a>: ${out}`);
  });

  it("still includes dividers and metadata", () => {
    const { llm, thread } = makeStubs();
    const out = formatInfo(llm, thread, { format: "plain" });
    assert.ok(out.includes(DIVIDER));
    assert.ok(out.includes("Model:"));
    assert.ok(out.includes("Thread Id:"));
  });
});
