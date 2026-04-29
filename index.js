require("dotenv").config();
const { Agent, setGlobalDispatcher } = require("undici");

// Apply globally to all undici requests (including fetch)
setGlobalDispatcher(
  new Agent({
    connect: {
      family: 4, // Forces IPv4
      keepAlive: true,
    },
  })
);

const servicesContainer = require("./src/services");
const setup = require("./src/setup");
const formatReply = require("./src/libs/formatReply");
const exportHtml = require("./src/libs/exportHtml");
const formatInfo = require("./src/libs/formatInfo");
const {
  INLINE_COMMANDS,
  BOT_COMMANDS,
  SLASH_COMMANDS,
} = require("./src/constants/commands");
const startSubscriber = require("./src/libs/subscriber");
const express = require("express");
const EnhancedBot = require("./src/bot");

const botUsername = process.env.TELEGRAM_BOT_USERNAME;
const token = process.env.TELEGRAM_BOT_TOKEN;
const mode = process.env.NODE_ENV;
const bot = new EnhancedBot(token, { mode }, servicesContainer);

bot.onMessage(async (message, services) => {
  try {
    // Incoming message is not valid, ignore it
    if (!message.isValid) return;
    if (message.inlineCommand(INLINE_COMMANDS.NOREPLY)) return;

    const { chatId } = message;

    // Load user data from database with message data
    const userService = services.get("user");
    try {
      await userService.loadFrom(message);
    } catch (error) {
      console.error("Error loading user:", error);
      return bot.sendMessage(chatId, "Error loading user: " + error.message);
    }
    const user = userService.current;
    if (message.isPrivate && user.isRestricted)
      return bot.sendMessage(chatId, "Access denied.");

    // Resolve the thread context with the message data
    const threadService = services.get("thread");
    const thread = await threadService.resolveOrCreate(message);
    // Incoming message is not in a valid thread context, ignore it
    if (!thread) return;

    // Create the prompt for the LLM
    const prompt = await userService.createPrompt();
    if (prompt.isEmpty) return;

    // Start processing prompt, send typing action to the user
    await bot.sendChatAction(chatId, "typing");

    await threadService.appendPrompt(prompt);

    const llm = services.get("llm");
    const reply = await llm.chat(thread, message);

    const replyOptions = { reply_to_message_id: message.id };
    const showInfo = message.inlineCommand(INLINE_COMMANDS.INFO);
    let sentMsg;
    try {
      const info = showInfo ? formatInfo(llm, thread) : "";
      sentMsg = await bot.sendMessage(chatId, formatReply(reply) + info, {
        ...replyOptions,
        parse_mode: "HTML",
      });
    } catch {
      const info = showInfo ? formatInfo(llm, thread, { format: "plain" }) : "";
      sentMsg = await bot.sendMessage(chatId, reply + info, replyOptions);
    }

    await threadService.save({ replyModel: llm.providerInfo() });
    await threadService.trackMessages(message.id, sentMsg.message_id);
  } catch (error) {
    console.error("Error handling message:", error);
    await bot.sendMessage(
      chatId,
      "Sorry, something went wrong. Please try again."
    );
  }
});

for (const cmd of Object.values(SLASH_COMMANDS)) {
  bot.onCommand(cmd, (incoming, services) =>
    services.get("botControl").handleCommand(incoming, services)
  );
}
bot.on("callback_query", (query) =>
  servicesContainer.get("botControl").handleCallback(query)
);

async function main() {
  startSubscriber(bot);

  await bot.setMyCommands(
    BOT_COMMANDS.map(({ command, description }) => ({ command, description })),
    { scope: { type: "all_private_chats" } }
  );

  const app = express();
  app.use(express.json());

  app.get("/archive/:hash", async (req, res) => {
    try {
      const thread = await servicesContainer
        .get("thread")
        .load(req.params.hash);
      if (!thread || thread.history.length === 0) {
        return res.status(404).send("Conversation not found or has expired.");
      }
      const html = exportHtml(thread.history, botUsername);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err) {
      console.error("Error rendering archive:", err);
      res.status(500).send("Error rendering conversation.");
    }
  });

  await setup({ app, bot }, { mode: process.env.NODE_ENV });
}

main();
