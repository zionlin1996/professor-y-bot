class Container {
  constructor() {
    this._registry = new Map();
  }

  register(name, value) {
    this._registry.set(name, value);
  }

  get(name) {
    const entry = this._registry.get(name);
    if (entry === undefined) throw new Error(`Service not found: ${name}`);
    if (typeof entry !== "function") return entry;
    const instance = entry(this);
    this._registry.set(name, instance);
    return instance;
  }
}

module.exports = Container;
