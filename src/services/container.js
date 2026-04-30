class Container {
  constructor() {
    this._registry = new Map();
    this._factories = new Set();
  }

  register(name, value) {
    this._registry.set(name, value);
  }

  // Always-fresh: calls factory on every get(), never caches the result.
  registerFactory(name, fn) {
    this._registry.set(name, fn);
    this._factories.add(name);
  }

  get(name) {
    const entry = this._registry.get(name);
    if (entry === undefined) throw new Error(`Service not found: ${name}`);
    if (typeof entry !== "function") return entry;
    const instance = entry(this);
    if (!this._factories.has(name)) {
      this._registry.set(name, instance);
    }
    return instance;
  }
}

module.exports = Container;
