const TelegramBot = require("node-telegram-bot-api");
const IncomingMessage = require("./dto/IncomingMessage");

class EnhancedBot extends TelegramBot {
  handleMessage = () => {};
  callbackHandlers = {};

  constructor(token, options) {
    super(token, {
      polling: options.mode !== "production",
      request: { family: 4 },
    });

    if (!token) {
      throw new Error("Telegram bot token is required");
    }

    this.on("error", (error) => {
      console.error("Bot error:", error);
    });

    this.on("polling_error", (error) => {
      console.error("Polling error:", error);
    });

    this.on("message", async (msg) => {
      const incoming = new IncomingMessage(msg);
      if (incoming.isCommand) {
        const command = incoming.command;
        const callback = this.callbackHandlers[command];
        if (callback) {
          return callback(incoming);
        }
      }
      return this.handleMessage(incoming);
    });
  }

  onMessage(callback) {
    this.handleMessage = callback;
  }
  onCommand(command, callback) {
    this.callbackHandlers[command] = callback;
  }
}

module.exports = EnhancedBot;
