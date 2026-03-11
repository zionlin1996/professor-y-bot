require("dotenv").config();

const EnhancedBot = require("./src/bot");
const setup = require("./src/setup");
const LLMClient = require("./src/llm");
const formatReply = require("./src/libs/formatReply");
const { getLastImage, toImageBlock } = require("./src/libs/attachments");
const preprocess = require("./src/libs/preprocess");
const express = require("express");

const token = process.env.TELEGRAM_BOT_TOKEN;
const botUsername = process.env.TELEGRAM_BOT_USERNAME;

const bot = new EnhancedBot(token, { mode: process.env.NODE_ENV });
const llm = new LLMClient();

const privateThreads = new Map(); // chatId -> threadId for DM conversations

bot.onMessage(async (msg) => {
  try {
    const chatId = msg.chat.id;

    const text = msg.text || msg.caption || "";
    const msgAttachment = getLastImage(msg);
    const replyAttachment = getLastImage(msg.reply_to_message);
    const targetAttachment = msgAttachment || replyAttachment;

    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    let userMessage = text;
    let threadId;

    if (isGroup) {
      const replyToId = msg.reply_to_message?.message_id;
      const isMentioned = text.includes(`@${botUsername}`);
      const existingThread = replyToId ? llm.resolveThread(replyToId) : null;

      if (existingThread) {
        // Reply to a tracked message — continue the thread, no @mention needed
        threadId = existingThread;
        userMessage = text;
      } else if (isMentioned) {
        // New @mention — start a fresh thread
        threadId = llm.createThread();

        if (msg.reply_to_message) {
          // Mentioned inside a reply: replied-to message is the context, mention text is the instruction
          const originalText =
            msg.reply_to_message.text || msg.reply_to_message.caption || "";
          const replyContent = text
            .replace(new RegExp(`@${botUsername}`, "g"), "")
            .trim();
          userMessage = replyContent
            ? `> ${originalText}\n\n${replyContent}`
            : originalText;
        } else {
          // Direct mention: use the message itself (minus the @mention) as the prompt
          userMessage = text
            .replace(new RegExp(`@${botUsername}`, "g"), "")
            .trim();
        }
      } else {
        return;
      }

      if ((!userMessage || userMessage === "") && !targetAttachment) return;
    } else {
      // Private chat: one persistent thread per chat
      if (!privateThreads.has(chatId)) {
        privateThreads.set(chatId, llm.createThread());
      }
      threadId = privateThreads.get(chatId);
    }

    const preprocessed = await preprocess(userMessage, { msg, bot, llm, chatId });
    if (preprocessed == null) return;
    userMessage = preprocessed;

    if (targetAttachment) {
      const file = await bot.getFile(targetAttachment.file_id);
      const imageBlock = await toImageBlock(token, file);
      userMessage = [
        { type: "text", text: userMessage || "What is in this image?" },
        imageBlock,
      ];
    }

    await bot.sendChatAction(chatId, "typing");
    const reply = await llm.chat(threadId, userMessage);

    let sentMsg;
    try {
      sentMsg = await bot.sendMessage(chatId, formatReply(reply), {
        reply_to_message_id: msg.message_id,
        parse_mode: "HTML",
      });
    } catch {
      // Fallback to plain text if Telegram rejects the HTML
      sentMsg = await bot.sendMessage(chatId, reply, {
        reply_to_message_id: msg.message_id,
      });
    }

    // Track the user's message and the bot's response so replies to either
    // will continue this thread without needing another @mention.
    if (isGroup) {
      llm.trackMessage(msg.message_id, threadId);
      llm.trackMessage(sentMsg.message_id, threadId);
    }
  } catch (error) {
    console.error("Error handling message:", error);
    await bot.sendMessage(
      msg.chat.id,
      "Sorry, something went wrong. Please try again.",
    );
  }
});

async function main() {
  const app = express();
  app.use(express.json());
  await setup({ app, bot }, { mode: process.env.NODE_ENV });
}

main();
