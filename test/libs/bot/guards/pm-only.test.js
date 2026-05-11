const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const pmOnly = require("../../../../src/libs/bot/guards/pm-only");

describe("pmOnly", () => {
  it("returns empty string (silent drop) for group messages", () => {
    assert.equal(pmOnly({ isGroup: true }), "");
  });

  it("returns null (pass through) for private messages", () => {
    assert.equal(pmOnly({ isGroup: false }), null);
  });
});
