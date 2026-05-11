const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Container = require("../../src/services/container");

describe("register — plain value", () => {
  it("returns the stored value on get()", () => {
    const c = new Container();
    c.register("db", { client: "fake" });
    assert.deepEqual(c.get("db"), { client: "fake" });
  });

  it("returns the same reference each time", () => {
    const c = new Container();
    const obj = {};
    c.register("thing", obj);
    assert.strictEqual(c.get("thing"), c.get("thing"));
  });
});

describe("register — factory function (lazy singleton)", () => {
  it("calls the factory on first get()", () => {
    const c = new Container();
    let calls = 0;
    c.register("svc", () => {
      calls++;
      return { id: calls };
    });
    assert.equal(calls, 0);
    c.get("svc");
    assert.equal(calls, 1);
  });

  it("caches the result — factory is called only once", () => {
    const c = new Container();
    let calls = 0;
    c.register("svc", () => {
      calls++;
      return {};
    });
    c.get("svc");
    c.get("svc");
    c.get("svc");
    assert.equal(calls, 1);
  });

  it("passes the container to the factory", () => {
    const c = new Container();
    c.register("dep", "dependency-value");
    let receivedContainer;
    c.register("svc", (container) => {
      receivedContainer = container;
      return {};
    });
    c.get("svc");
    assert.strictEqual(receivedContainer, c);
  });

  it("factory can resolve other services from the container", () => {
    const c = new Container();
    c.register("a", () => 1);
    c.register("b", (c) => c.get("a") + 1);
    assert.equal(c.get("b"), 2);
  });
});

describe("registerFactory — always-fresh", () => {
  it("calls the factory on every get()", () => {
    const c = new Container();
    let calls = 0;
    c.registerFactory("svc", () => {
      calls++;
      return { calls };
    });
    c.get("svc");
    c.get("svc");
    c.get("svc");
    assert.equal(calls, 3);
  });

  it("returns a new instance each call", () => {
    const c = new Container();
    c.registerFactory("svc", () => ({}));
    const a = c.get("svc");
    const b = c.get("svc");
    assert.notStrictEqual(a, b);
  });
});

describe("get — missing service", () => {
  it("throws when the service is not registered", () => {
    const c = new Container();
    assert.throws(() => c.get("missing"), /Service not found: missing/);
  });
});
