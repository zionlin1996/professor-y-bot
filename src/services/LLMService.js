const { readFileSync } = require("fs");
const { join } = require("path");

function loadPrompt(filename) {
  return readFileSync(join(__dirname, "../llm/prompts", filename), "utf8")
    .trim()
    .replace(/%BOT_NAME%/g, process.env.TELEGRAM_BOT_USERNAME || "bot");
}

const DEFAULT_SYSTEM_PROMPT = [
  loadPrompt("ROLE.md"),
  loadPrompt("BOT.md"),
  loadPrompt("TOOLS.md"),
].join("\n\n");

const BACKENDS = {
  openai: () => require("../llm/backends/openai"),
  claude: () => require("../llm/backends/claude"),
  gemini: () => require("../llm/backends/gemini"),
  lumo: () => require("../llm/backends/lumo"),
};

const DEFAULT_BACKEND = "claude";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const SETTINGS_KEY = "setting:active_model";

class LLMService {
  static modelListCache = {};

  constructor({ store } = {}) {
    this._store = store;
    this._initBackend(DEFAULT_BACKEND, DEFAULT_MODEL);
  }

  _initBackend(backendName, modelName) {
    const loadBackend = BACKENDS[backendName];
    if (!loadBackend) throw new Error(`Unknown backend: "${backendName}"`);
    const Backend = loadBackend();
    this.backend = new Backend();
    this.backend.model = modelName;
    this.backendName = backendName;
  }

  /** Load persisted model selection from Redis. Called per-request; also once on startup as a warm-up. */
  async init() {
    const stored = await this._store?.get(SETTINGS_KEY);
    if (!stored) return;
    try {
      const { backend, model } = JSON.parse(stored);
      this._initBackend(backend, model);
    } catch {
      // Corrupted or stale entry — stay with default
    }
  }

  /** Fetch available models from all configured backends. Populates modelListCache. */
  async listModels() {
    LLMService.modelListCache = {};
    const results = [];
    for (const [name, load] of Object.entries(BACKENDS)) {
      try {
        const Backend = load();
        const instance = new Backend();
        const models = await instance.listModels();
        if (models.length) {
          LLMService.modelListCache[name] = models;
          results.push({ backend: name, models });
        }
      } catch {
        // Skip backends that have no API key or fail
      }
    }
    return results;
  }

  /** Switch the active backend+model and persist the choice. */
  async setActiveModel(backendName, modelName) {
    this._initBackend(backendName, modelName);
    await this._store?.set(SETTINGS_KEY, JSON.stringify({ backend: backendName, model: modelName }), null);
  }

  providerInfo() {
    return `${this.backendName} / ${this.backend.model}`;
  }

  /** Backends with at least one cached model from the most recent listModels() call. */
  availableBackends() {
    return Object.keys(LLMService.modelListCache);
  }

  /** Cached model names for a backend (empty array if none). */
  models(backendName) {
    return LLMService.modelListCache[backendName] || [];
  }

  /** Cached model name at index, or undefined. */
  modelAt(backendName, index) {
    return LLMService.modelListCache[backendName]?.[index];
  }

  // thread.history must already contain the user message (appended via threadService.appendMessage()).
  // Appends the assistant reply to thread.history; caller is responsible for threadService.save().
  async chat(thread, incoming) {
    const { chatId, userId, username } = incoming;
    const tz = process.env.TZ || "UTC";
    const currentTime = `Current time: ${new Date().toLocaleString("en-US", { timeZone: tz, hour12: false, dateStyle: "full", timeStyle: "long" })} (${tz})`;

    const systemPrompt = [
      DEFAULT_SYSTEM_PROMPT,
      currentTime,
      process.env.LLM_SYSTEM_PROMPT,
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages = [
      { role: "system", content: systemPrompt },
      ...thread.history,
    ];

    const reply = await this.backend.complete(messages, { chatId, userId, username });
    thread.append("assistant", reply);

    return reply;
  }
}

module.exports = LLMService;
