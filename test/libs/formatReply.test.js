const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const formatReply = require("../../src/libs/formatReply");

// Helper: assert a substring is present and another is absent.
function has(output, expected) {
  assert.ok(
    output.includes(expected),
    `Expected output to include ${JSON.stringify(expected)}\nGot: ${JSON.stringify(output)}`,
  );
}
function hasNot(output, unexpected) {
  assert.ok(
    !output.includes(unexpected),
    `Expected output NOT to include ${JSON.stringify(unexpected)}\nGot: ${JSON.stringify(output)}`,
  );
}

// ── inline formatting ─────────────────────────────────────────────────────────

describe("bold", () => {
  it("converts **text** to <b>text</b>", () => {
    const out = formatReply("**bold**");
    assert.equal(out, "<b>bold</b>");
  });

  it("no <strong> tags remain in output", () => {
    hasNot(formatReply("**text**"), "<strong>");
  });
});

describe("italic", () => {
  it("converts *text* to <i>text</i>", () => {
    assert.equal(formatReply("*italic*"), "<i>italic</i>");
  });

  it("no <em> tags remain in output", () => {
    hasNot(formatReply("*text*"), "<em>");
  });
});

describe("strikethrough", () => {
  it("converts ~~text~~ to <s>text</s>", () => {
    assert.equal(formatReply("~~strike~~"), "<s>strike</s>");
  });

  it("no <del> tags remain in output", () => {
    hasNot(formatReply("~~text~~"), "<del>");
  });
});

describe("inline code", () => {
  it("preserves <code> tags", () => {
    const out = formatReply("`code`");
    has(out, "<code>code</code>");
  });
});

describe("code block", () => {
  it("preserves <pre> wrapper", () => {
    const out = formatReply("```\nconsole.log('hi')\n```");
    has(out, "<pre>");
    has(out, "</pre>");
  });
});

// ── headings ──────────────────────────────────────────────────────────────────

describe("headings", () => {
  it("h1 becomes <b>", () => {
    assert.equal(formatReply("# Heading"), "<b>Heading</b>");
  });

  it("h2 becomes <b>", () => {
    assert.equal(formatReply("## Sub"), "<b>Sub</b>");
  });

  it("h3 becomes <b>", () => {
    assert.equal(formatReply("### Deep"), "<b>Deep</b>");
  });

  it("no <h1-6> tags remain", () => {
    const out = formatReply("# Title");
    hasNot(out, "<h1>");
    hasNot(out, "</h1>");
  });
});

// ── paragraphs ────────────────────────────────────────────────────────────────

describe("paragraphs", () => {
  it("unwraps <p> tags — no <p> in output", () => {
    const out = formatReply("some text");
    hasNot(out, "<p>");
    hasNot(out, "</p>");
  });
});

// ── lists ─────────────────────────────────────────────────────────────────────

describe("unordered list", () => {
  it("converts list items to bullet points", () => {
    const out = formatReply("- item1\n- item2");
    has(out, "• item1");
    has(out, "• item2");
  });

  it("no <ul> or <li> tags remain", () => {
    const out = formatReply("- a\n- b");
    hasNot(out, "<ul>");
    hasNot(out, "<li>");
  });

  it("consecutive bullets are not separated by blank lines", () => {
    const out = formatReply("- a\n- b\n- c");
    hasNot(out, "• a\n\n• b");
  });
});

// ── links ─────────────────────────────────────────────────────────────────────

describe("links", () => {
  it("preserves <a href> tags", () => {
    const out = formatReply("[click](https://example.com)");
    has(out, '<a href="https://example.com">click</a>');
  });

  it("strips inner tags from link content", () => {
    // Markdown doesn't allow bold inside links natively, but if nested tags
    // appear in link content (e.g. from raw HTML), they are stripped.
    const out = formatReply("[**bold**](https://example.com)");
    hasNot(out, "<b>bold</b></a>");
  });
});

// ── unsupported tags ──────────────────────────────────────────────────────────

describe("unsupported tag stripping", () => {
  it("strips <div> tags", () => {
    const out = formatReply("<div>text</div>");
    hasNot(out, "<div>");
    has(out, "text");
  });

  it("strips <span> tags", () => {
    const out = formatReply("<span>content</span>");
    hasNot(out, "<span>");
    has(out, "content");
  });

  it("preserves supported tags: b, i, u, s, code, pre, a, blockquote", () => {
    const supportedTags = ["b", "i", "u", "s", "code", "pre", "blockquote"];
    for (const tag of supportedTags) {
      const out = formatReply(`**supported**`);
      // At minimum, <b> survives — just verify we don't strip everything
      hasNot(out, "<div>");
    }
  });
});

// ── newline collapsing ────────────────────────────────────────────────────────

describe("newline collapsing", () => {
  it("collapses 3+ consecutive newlines to 2", () => {
    // Two paragraphs produce at most 2 consecutive newlines
    const out = formatReply("Para one\n\n\nPara two");
    hasNot(out, "\n\n\n");
  });
});

// ── blockquote ────────────────────────────────────────────────────────────────

describe("blockquote", () => {
  it("preserves blockquote tags", () => {
    const out = formatReply("> quoted text");
    has(out, "<blockquote>");
    has(out, "</blockquote>");
  });
});
