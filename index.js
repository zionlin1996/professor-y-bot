require("dotenv").config();

const EnhancedBot = require("./src/bot");
const setup = require("./src/setup");
const LLMClient = require("./src/llm");
const formatReply = require("./src/libs/formatReply");
const express = require("express");

const token = process.env.TELEGRAM_BOT_TOKEN;
const botUsername = process.env.TELEGRAM_BOT_USERNAME;

const bot = new EnhancedBot(token, { mode: process.env.NODE_ENV });
const llm = new LLMClient();

bot.onMessage(async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text;
    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    let userMessage = text;

    if (isGroup) {
      if (!text.includes(`@${botUsername}`)) return;

      if (msg.reply_to_message) {
        // Mentioned inside a reply: replied-to message is the context, mention text is the instruction
        const originalText = msg.reply_to_message.text || "";
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

      if (!userMessage) return;
    }
    await bot.sendChatAction(chatId, "typing");
    const reply = await llm.chat(chatId, msg.from.id, userMessage);
    try {
      await bot.sendMessage(chatId, formatReply(reply), {
        reply_to_message_id: msg.message_id,
        parse_mode: "HTML",
      });
    } catch {
      // Fallback to plain text if Telegram rejects the HTML
      await bot.sendMessage(chatId, reply, {
        reply_to_message_id: msg.message_id,
      });
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
