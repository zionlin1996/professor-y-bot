const { readFileSync } = require("fs");
const { join } = require("path");
const store = require("../libs/store");

function loadPrompt(filename) {
  return readFileSync(join(__dirname, "prompts", filename), "utf8")
    .trim()
    .replace(/%BOT_NAME%/g, process.env.TELEGRAM_BOT_USERNAME || "bot");
}

const DEFAULT_SYSTEM_PROMPT = [
  loadPrompt("ROLE.md"),
  loadPrompt("BOT.md"),
  loadPrompt("TOOLS.md"),
].join("\n\n");

const BACKENDS = {
  openai: () => require("./backends/openai"),
  claude: () => require("./backends/claude"),
  gemini: () => require("./backends/gemini"),
  lumo: () => require("./backends/lumo"),
};

const DEFAULT_BACKEND = "claude";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const SETTINGS_KEY = "setting:active_model";

class LLMClient {
  constructor() {
    this._modelListCache = {};
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

  /** Load persisted model selection from Redis. Call once on startup. */
  async init() {
    const stored = await store.get(SETTINGS_KEY);
    if (!stored) return;
    try {
      const { backend, model } = JSON.parse(stored);
      this._initBackend(backend, model);
    } catch {
      // Corrupted or stale entry — stay with default
    }
  }

  /** Fetch available models from all configured backends. Populates _modelListCache. */
  async listModels() {
    this._modelListCache = {};
    const results = [];
    for (const [name, load] of Object.entries(BACKENDS)) {
      try {
        const Backend = load();
        const instance = new Backend();
        const models = await instance.listModels();
        if (models.length) {
          this._modelListCache[name] = models;
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
    await store.set(SETTINGS_KEY, JSON.stringify({ backend: backendName, model: modelName }), null);
  }

  providerInfo() {
    return `${this.backendName} / ${this.backend.model}`;
  }

  // thread.history must already contain the user message (appended via thread.appendMessage()).
  async chat(thread, { chatId, userId, username } = {}) {
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
    await thread.save({ replyModel: this.providerInfo() });

    return reply;
  }
}

module.exports = LLMClient;
