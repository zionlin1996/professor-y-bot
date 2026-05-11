const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const profile = require("../../../../src/libs/bot/guards/profile");

function makeServices(db) {
  return { get: (name) => (name === "db" ? db : null) };
}

describe("profile guard", () => {
  it("returns error string when userId is falsy (empty string)", () => {
    const result = profile({ userId: "" }, makeServices({}));
    assert.equal(result, "Unable to identify you.");
  });

  it("returns error string when userId is null", () => {
    const result = profile({ userId: null }, makeServices({}));
    assert.equal(result, "Unable to identify you.");
  });

  it("returns DB error string when db is null", () => {
    const result = profile({ userId: "123" }, makeServices(null));
    assert.equal(result, "Database not available.");
  });

  it("returns null (pass through) when userId is set and db is available", () => {
    const result = profile({ userId: "123" }, makeServices({ findUnique: () => {} }));
    assert.equal(result, null);
  });
});
