require("dotenv").config();

const EnhancedBot = require("./src/bot");
const setup = require("./src/setup");
const LLMService = require("./src/services/LLMService");
const store = require("./src/libs/store");
const formatReply = require("./src/libs/formatReply");
const exportHtml = require("./src/libs/exportHtml");
const { toImageBlock } = require("./src/libs/attachments");
const formatInfo = require("./src/libs/formatInfo");
const { getDb } = require("./src/libs/db");
const {
  INLINE_COMMANDS,
  BOT_COMMANDS,
  SLASH_COMMANDS,
} = require("./src/constants/commands");
const startSubscriber = require("./src/libs/subscriber");
const { ThreadService } = require("./src/services/ThreadService");
const BotControlService = require("./src/services/BotControlService");
const express = require("express");

const token = process.env.TELEGRAM_BOT_TOKEN;
const botUsername = process.env.TELEGRAM_BOT_USERNAME;

const db = getDb();
const bot = new EnhancedBot(token, { mode: process.env.NODE_ENV });
const llm = new LLMService({ store });
const botControl = new BotControlService({ bot, llm, db });

for (const cmd of Object.values(SLASH_COMMANDS)) {
  bot.onCommand(cmd, (incoming) => botControl.handleCommand(incoming));
}

bot.onMessage(async (message) => {
  try {
    if (!message.isValid) return;
    if (message.inlineCommand(INLINE_COMMANDS.NOREPLY)) return;

    const threadService = new ThreadService(message, { store, db });
    const result = await threadService.resolveOrCreate();
    if (!result) return;
    if (result.reject) return bot.sendMessage(message.chatId, result.reason);

    const thread = threadService.thread;

    // Build the user message — attach image if present
    let userMessage = result.userMessage;
    let attachment = null;
    if (message.targetAttachment) {
      const imageBlock = await toImageBlock(bot, message.targetAttachment);
      attachment = {
        fileId: message.targetAttachment.file_id,
        mediaType: imageBlock.mediaType,
      };
      userMessage = [
        {
          type: "text",
          text:
            message.senderPrefix + (userMessage || "What is in this image?"),
        },
        imageBlock,
      ];
    } else if (userMessage) {
      userMessage = message.senderPrefix + userMessage;
    }

    if (!userMessage && !attachment) return;

    await threadService.appendMessage(message.text, userMessage, {
      userId: message.userId,
      attachment,
    });

    await bot.sendChatAction(message.chatId, "typing");
    const reply = await llm.chat(thread, message);

    const replyOptions = { reply_to_message_id: message.id };
    const showInfo = message.inlineCommand(INLINE_COMMANDS.INFO);
    let sentMsg;
    try {
      const info = showInfo ? formatInfo(llm, thread) : "";
      sentMsg = await bot.sendMessage(
        message.chatId,
        formatReply(reply) + info,
        {
          ...replyOptions,
          parse_mode: "HTML",
        },
      );
    } catch {
      const info = showInfo ? formatInfo(llm, thread, { format: "plain" }) : "";
      sentMsg = await bot.sendMessage(
        message.chatId,
        reply + info,
        replyOptions,
      );
    }

    await threadService.save({ replyModel: llm.providerInfo() });
    await threadService.trackMessages(message.id, sentMsg.message_id);
  } catch (error) {
    console.error("Error handling message:", error);
    await bot.sendMessage(
      message.chatId,
      "Sorry, something went wrong. Please try again.",
    );
  }
});

bot.on("callback_query", (query) => botControl.handleCallback(query));

async function main() {
  await llm.init();
  await startSubscriber(bot);

  await bot.setMyCommands(
    BOT_COMMANDS.map(({ command, description }) => ({ command, description })),
    { scope: { type: "all_private_chats" } },
  );

  const app = express();
  app.use(express.json());

  app.get("/archive/:hash", async (req, res) => {
    try {
      const threadService = new ThreadService(null, { store, db });
      const thread = await threadService.load(req.params.hash);
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
