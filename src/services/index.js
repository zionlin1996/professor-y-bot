const { getDb } = require("../libs/db");
const store = require("../libs/store");
const LLMService = require("./LLMService");
const ThreadService = require("./ThreadService");
const BotControlService = require("./BotControlService");
const UserService = require("./UserService");
const Container = require("./container");

// LLMService must be a singleton — _modelListCache must persist across requests
const llmService = new LLMService({ store });

function createSeriviceContainer() {
  const container = new Container();
  container.register("store", () => store);
  container.register("db", () => getDb());
  container.register("user", (c) => new UserService({ db: c.get("db") }));
  container.register("llm", () => llmService);
  container.register(
    "botControl",
    (c) => new BotControlService({ llm: c.get("llm"), db: c.get("db") }),
  );
  container.register(
    "thread",
    (c) =>
      new ThreadService({
        store: c.get("store"),
        db: c.get("db"),
        user: c.get("user"),
      }),
  );
  return container;
}

module.exports = createSeriviceContainer;
