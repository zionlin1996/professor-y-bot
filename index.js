require("dotenv").config();

const EnhancedBot = require("./src/bot");
const setup = require("./src/setup");
const LLMClient = require("./src/llm");
const Thread = require("./src/llm/Thread");
const formatReply = require("./src/libs/formatReply");
const exportHtml = require("./src/libs/exportHtml");
const { getLastImage, toImageBlock } = require("./src/libs/attachments");
const preprocess = require("./src/libs/preprocess");
const formatInfo = require("./src/libs/formatInfo");
const { getStealthMode } = require("./src/libs/userPreference");
const { INLINE_COMMANDS, BOT_COMMANDS } = require("./src/constants/commands");
const startSubscriber = require("./src/libs/subscriber");
const express = require("express");

const ADMIN_USERNAME = "yanglin1112";

const token = process.env.TELEGRAM_BOT_TOKEN;
const botUsername = process.env.TELEGRAM_BOT_USERNAME;

const allowList = process.env.PRIVATE_CHAT_ALLOWED_USERS;

const allowedUserIds = new Set(allowList.split(",").map((id) => +id.trim()));

const bot = new EnhancedBot(token, { mode: process.env.NODE_ENV });
const llm = new LLMClient();

bot.onMessage(async (msg) => {
  try {
    if (!msg.text && !getLastImage(msg)) return; // ignore non-text, non-image messages
    if (msg.forward_origin) return; // ignore forwarded messages

    const chatId = msg.chat.id;

    const text = msg.text || msg.caption || "";
    if (text.includes("白爛+1")) return; // keyword filter: silently drop
    if (text.includes(INLINE_COMMANDS.NOREPLY)) return; // inline action: suppress LLM reply
    const showInfo = text.includes(INLINE_COMMANDS.INFO); // inline action: append model/thread/archive info

    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

    // Handle bot commands before thread/mention routing — commands bypass the LLM entirely
    if (await preprocess({ msg, bot, llm, chatId, isGroup })) return;

    const msgAttachment = getLastImage(msg);
    const replyAttachment = getLastImage(msg.reply_to_message);
    const targetAttachment = msgAttachment || replyAttachment;

    const userId = msg.from?.id;
    const stealth = await getStealthMode(userId);

    let userMessage = text;
    let thread;

    if (isGroup) {
      const replyToId = msg.reply_to_message?.message_id;
      const isMentioned = text.includes(`@${botUsername}`);
      thread = replyToId ? await Thread.resolve(replyToId, { stealth }) : null;

      if (thread) {
        // Reply to a tracked message — continue the thread, no @mention needed
        thread.stealth = stealth;
        userMessage = text;
      } else if (isMentioned) {
        // New @mention — start a fresh thread
        thread = await Thread.create({ chatId, userId, stealth });

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
        return; // not a tracked reply and no @mention — ignore
      }

      if ((!userMessage || userMessage === "") && !targetAttachment) return; // nothing to send
    } else {
      // Private chat: restricted to allowlist
      if (!allowedUserIds.has(msg.from?.id)) {
        await bot.sendMessage(
          chatId,
          "Sorry, private chat access is restricted.",
        );
        return;
      }
      const replyToId = msg.reply_to_message?.message_id;
      thread =
        (replyToId ? await Thread.resolve(replyToId, { stealth }) : null) ??
        (await Thread.create({ chatId, userId, stealth }));
      if (thread) thread.stealth = stealth;
    }

    // Strip !info token — the flag is captured; the token itself is not part of the user intent
    if (showInfo) {
      userMessage =
        typeof userMessage === "string"
          ? userMessage
              .replace(new RegExp(INLINE_COMMANDS.INFO, "g"), "")
              .trim()
          : userMessage;
    }

    // Capture clean user input before adding the sender prefix for LLM context
    const processedUserInput = userMessage;

    // Prepend sender so the LLM can distinguish between users in the same thread
    const senderName = msg.from?.username || msg.from?.first_name || "user";
    const senderPrefix = `@${senderName}: `;
    if (userMessage) {
      userMessage = senderPrefix + userMessage;
    }

    let attachment = null;
    if (targetAttachment) {
      const file = await bot.getFile(targetAttachment.file_id);
      const imageBlock = await toImageBlock(token, file);
      attachment = { fileId: targetAttachment.file_id, mediaType: imageBlock.mediaType };
      userMessage = [
        {
          type: "text",
          text: userMessage || `${senderPrefix}What is in this image?`,
        },
        imageBlock,
      ];
    }

    // Append to history and persist user message to DB before calling LLM —
    // guarantees a record even if the LLM fails to respond.
    await thread.appendMessage(processedUserInput, userMessage, {
      userId,
      attachment,
    });

    await bot.sendChatAction(chatId, "typing");
    const reply = await llm.chat(thread, {
      chatId,
      userId,
      username: msg.from?.username || msg.from?.first_name,
    });

    const replyOptions = { reply_to_message_id: msg.message_id };
    let sentMsg;
    try {
      const info = showInfo ? await formatInfo(llm, thread) : "";
      sentMsg = await bot.sendMessage(chatId, formatReply(reply) + info, {
        ...replyOptions,
        parse_mode: "HTML",
      });
    } catch {
      const info = showInfo
        ? await formatInfo(llm, thread, { format: "plain" })
        : "";
      // Fallback to plain text if Telegram rejects the HTML
      sentMsg = await bot.sendMessage(chatId, reply + info, replyOptions);
    }

    // Track the user's message and the bot's response so replies to either
    // will continue this thread without needing another @mention.
    await thread.trackMessage(msg.message_id);
    await thread.trackMessage(sentMsg.message_id);
  } catch (error) {
    console.error("Error handling message:", error);
    await bot.sendMessage(
      msg.chat.id,
      "Sorry, something went wrong. Please try again.",
    );
  }
});

bot.on("callback_query", async (query) => {
  const { data, message, from } = query;
  if (from?.username !== ADMIN_USERNAME) {
    await bot.answerCallbackQuery(query.id); // silently dismiss for non-admins
    return;
  }

  const chatId = message.chat.id;
  const messageId = message.message_id;

  try {
    if (data.startsWith("mp:")) {
      // Show model list for chosen provider
      const backendName = data.slice(3);
      const models = llm._modelListCache[backendName] || [];
      const rows = models.map((m, i) => [
        { text: m, callback_data: `ms:${backendName}:${i}` },
      ]);
      rows.push([{ text: "← Back", callback_data: "mb" }]);
      await bot.editMessageText(`<b>${backendName}</b> — select a model:`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows },
      });
      await bot.answerCallbackQuery(query.id);
    } else if (data.startsWith("ms:")) {
      // Select a model
      const [, backendName, indexStr] = data.split(":");
      const modelName = llm._modelListCache[backendName]?.[parseInt(indexStr)];
      if (modelName) {
        await llm.setActiveModel(backendName, modelName);
        await bot.editMessageText(
          `✓ Switched to <b>${backendName} / ${modelName}</b>`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
          },
        );
        await bot.answerCallbackQuery(query.id, {
          text: `Now using ${modelName}`,
        });
      } else {
        await bot.answerCallbackQuery(query.id, { text: "Model not found" });
      }
    } else if (data === "mb") {
      // Back to provider list
      const rows = [];
      const groups = Object.keys(llm._modelListCache);
      for (let i = 0; i < groups.length; i += 2) {
        rows.push(
          groups.slice(i, i + 2).map((name) => ({
            text: name.charAt(0).toUpperCase() + name.slice(1),
            callback_data: `mp:${name}`,
          })),
        );
      }
      await bot.editMessageText(
        `Current: <b>${llm.providerInfo()}</b>\n\nChoose a provider:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: rows },
        },
      );
      await bot.answerCallbackQuery(query.id);
    }
  } catch (err) {
    console.error("Error handling callback_query:", err);
    await bot.answerCallbackQuery(query.id, { text: "Something went wrong" });
  }
});

async function main() {
  await llm.init();
  startSubscriber(bot);

  // Register bot commands with Telegram — all commands are PM only
  await bot.setMyCommands(
    BOT_COMMANDS.map(({ command, description }) => ({ command, description })),
    { scope: { type: "all_private_chats" } },
  );

  const app = express();
  app.use(express.json());

  app.get("/archive/:hash", async (req, res) => {
    try {
      const thread = await Thread.load(req.params.hash);
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
