const TelegramBot = require("node-telegram-bot-api");
const IncomingMessage = require("./dto/IncomingMessage");

class EnhancedBot extends TelegramBot {
  handleMessage = () => {};
  handleCallback = () => {};
  callbackHandlers = {};

  constructor(token, options) {
    super(token, {
      polling: options.mode !== "production",
      request: { family: 4 },
    });

    if (!token) {
      throw new Error("Telegram bot token is required");
    }

    const { serviceContainerFactory } = options;

    this.on("error", (error) => {
      console.error("Bot error:", error);
    });

    this.on("polling_error", (error) => {
      console.error("Polling error:", error);
    });

    this.on("message", async (msg) => {
      const incoming = new IncomingMessage(msg);
      const services = serviceContainerFactory();
      await services.get("llm").init();
      if (incoming.isCommand) {
        const command = incoming.command;
        const handler = this.callbackHandlers[command];
        if (handler) {
          return handler(incoming, services);
        }
      }
      return this.handleMessage(incoming, services);
    });

    this.on("callback_query", async (query) => {
      const services = serviceContainerFactory();
      await services.get("llm").init();
      return this.handleCallback(query, services);
    });
  }

  onMessage(callback) {
    this.handleMessage = callback;
  }
  onCommand(command, ...args) {
    const guards = args.slice(0, -1);
    const callback = args[args.length - 1];
    this.callbackHandlers[command] = async (incoming, services) => {
      for (const guard of guards) {
        const err = await guard(incoming, services);
        if (err !== null) {
          if (err) await this.sendMessage(incoming.chatId, err, { reply_to_message_id: incoming.id });
          return;
        }
      }
      return callback(incoming, services);
    };
  }
  onCallback(callback) {
    this.handleCallback = callback;
  }
}

module.exports = EnhancedBot;
