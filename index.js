require("dotenv").config();
const { Agent, setGlobalDispatcher } = require("undici");

// Apply globally to all undici requests (including fetch)
setGlobalDispatcher(
  new Agent({
    connect: {
      family: 4, // Forces IPv4
      keepAlive: true,
    },
  }),
);

const setup = require("./src/setup");
const formatReply = require("./src/libs/formatReply");
const exportHtml = require("./src/libs/exportHtml");
const formatInfo = require("./src/libs/formatInfo");
const { findBestMatch: findBakiMatch } = require("./src/llm/tools/baki-lookup");
const {
  INLINE_COMMANDS,
  BOT_COMMANDS,
  SLASH_COMMANDS,
} = require("./src/constants/commands");
const startSubscriber = require("./src/libs/subscriber");
const profileGuard = require("./src/libs/bot/guards/profile");
const pmOnly = require("./src/libs/bot/guards/pm-only");

function backendRows(names) {
  const rows = [];
  for (let i = 0; i < names.length; i += 2) {
    rows.push(
      names.slice(i, i + 2).map((name) => ({
        text: name.charAt(0).toUpperCase() + name.slice(1),
        callback_data: `mp:${name}`,
      })),
    );
  }
  return rows;
}
const express = require("express");
const EnhancedBot = require("./src/bot");
const createServiceContainer = require("./src/services");

const botUsername = process.env.TELEGRAM_BOT_USERNAME;
const token = process.env.TELEGRAM_BOT_TOKEN;
const mode = process.env.NODE_ENV;
const bot = new EnhancedBot(token, {
  mode,
  serviceContainerFactory: createServiceContainer,
});

bot.onMessage(async (message, services) => {
  const threadService = services.get("thread");
  try {
    // Incoming message is not valid, ignore it
    if (!message.isValid) return;
    if (message.inlineCommand(INLINE_COMMANDS.NOREPLY)) return;

    if (message.inlineCommand(INLINE_COMMANDS.BAKI)) {
      const description = message.mentionStrippedText.trim();
      if (!description) {
        return bot.sendMessage(
          message.chatId,
          "請加上描述。例如：<code>!baki 德川一臉懷疑</code>",
          { reply_to_message_id: message.id, parse_mode: "HTML" },
        );
      }
      const llm = services.get("llm");
      await llm.init();
      try {
        const match = await findBakiMatch(description, llm.backend);
        if (!match) {
          return bot.sendMessage(
            message.chatId,
            "找不到符合的刃牙圖，換個描述試試？",
            { reply_to_message_id: message.id },
          );
        }
        const imgRes = await fetch(match.url);
        if (!imgRes.ok) throw new Error(`imgur fetch failed: ${imgRes.status}`);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        return bot.sendPhoto(message.chatId, imgBuffer, {
          reply_to_message_id: message.id,
        });
      } catch (err) {
        console.error("Baki lookup error:", err);
        return bot.sendMessage(
          message.chatId,
          "查詢失敗，請再試一次。",
          { reply_to_message_id: message.id },
        );
      }
    }

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

    await threadService.updateReply(sentMsg.message_id, {
      replyModel: llm.providerInfo(),
    });
  } catch (error) {
    console.error("Error handling message:", error);
    await bot.sendMessage(
      message.chatId,
      "Sorry, something went wrong. Please try again.",
    );
  }
});

bot.onCommand(
  SLASH_COMMANDS.START,
  pmOnly,
  profileGuard,
  async (incoming, services) => {
    const db = services.get("db");
    const { userId, username, from } = incoming;
    const uid = String(userId);
    const displayName = username ? `@${username}` : from?.first_name || uid;

    const existing = await db.userProfile.findUnique({ where: { id: uid } });
    if (existing)
      return bot.sendMessage(
        incoming.chatId,
        "Your profile is already set up. Use /me to view your notes.",
        { reply_to_message_id: incoming.id },
      );

    await db.userProfile.create({
      data: { id: uid, username: username || null },
    });

    const admins = await db.userProfile.findMany({
      where: { permissionLevel: 0 },
    });
    await Promise.all(
      admins.map((admin) =>
        bot.sendMessage(
          admin.id,
          `New user joined: ${displayName} (ID: <code>${uid}</code>)\nGrant PM access?`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✓ Enable", callback_data: `up_e:${uid}` },
                  { text: "✗ Ignore", callback_data: `up_i:${uid}` },
                ],
              ],
            },
          },
        ),
      ),
    );
    return bot.sendMessage(
      incoming.chatId,
      "Profile created! You'll be notified once your access is confirmed.",
      { reply_to_message_id: incoming.id },
    );
  },
);

bot.onCommand(
  SLASH_COMMANDS.ME,
  pmOnly,
  profileGuard,
  async (incoming, services) => {
    const db = services.get("db");
    const { id, chatId, userId, username } = incoming;
    const record = await db.userProfile.findUnique({
      where: { id: String(userId) },
    });
    const displayName = username ? `@${username}` : "your account";
    if (!record || !record.notes)
      return bot.sendMessage(
        chatId,
        `No profile on record for ${displayName}.`,
        {
          reply_to_message_id: id,
        },
      );

    return bot.sendMessage(
      chatId,
      `<b>${displayName}'s profile:</b>\n\n${record.notes}`,
      { parse_mode: "HTML", reply_to_message_id: id },
    );
  },
);

bot.onCommand(
  SLASH_COMMANDS.FORGET,
  pmOnly,
  profileGuard,
  async (incoming, services) => {
    const db = services.get("db");
    const { userId, username } = incoming;
    const uid = String(userId);
    const displayName = username ? `@${username}` : "your account";
    const record = await db.userProfile.findUnique({ where: { id: uid } });
    if (!record || !record.notes)
      return bot.sendMessage(
        incoming.chatId,
        `No profile on record for ${displayName} — nothing to clear.`,
        { reply_to_message_id: incoming.id },
      );

    await db.userProfile.update({ where: { id: uid }, data: { notes: "" } });
    return bot.sendMessage(
      incoming.chatId,
      `Profile cleared for ${displayName}.`,
      { reply_to_message_id: incoming.id },
    );
  },
);

bot.onCommand(
  SLASH_COMMANDS.STEALTH,
  pmOnly,
  profileGuard,
  async (incoming, services) => {
    const db = services.get("db");
    const { userId, text } = incoming;
    const arg = text.trim().split(/\s+/)[1]?.toLowerCase();
    const enable = arg !== "off";

    const { count } = await db.userProfile.updateMany({
      where: { id: userId },
      data: { stealthMode: enable },
    });
    if (count === 0)
      return bot.sendMessage(
        incoming.chatId,
        "No profile found — run /start first to set up your profile.",
        { reply_to_message_id: incoming.id },
      );
    return bot.sendMessage(
      incoming.chatId,
      enable
        ? "Stealth mode ON — your messages will not be stored to the database."
        : "Stealth mode OFF — your messages will be stored normally.",
      { reply_to_message_id: incoming.id },
    );
  },
);

bot.onCommand(SLASH_COMMANDS.MODEL, pmOnly, async (incoming, services) => {
  const llm = services.get("llm");
  const { chatId } = incoming;

  let isAdmin = false;
  try {
    const userService = services.get("user");
    await userService.loadFrom(incoming);
    isAdmin = userService.current.isAdmin;
  } catch {}

  if (!isAdmin)
    return bot.sendMessage(chatId, llm.providerInfo(), {
      reply_to_message_id: incoming.id,
    });

  const groups = await llm.listModels();
  if (!groups.length)
    return bot.sendMessage(
      chatId,
      "No models available — check your API keys.",
    );

  return bot.sendMessage(
    chatId,
    `Current: <b>${llm.providerInfo()}</b>\n\nChoose a provider:`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: backendRows(groups.map((g) => g.backend)),
      },
    },
  );
});

bot.onCallback(async (query, services) => {
  const { data, message, from } = query;
  const db = services.get("db");
  const llm = services.get("llm");
  const chatId = message.chat.id;
  const messageId = message.message_id;

  let isAdmin = false;
  try {
    const userService = services.get("user");
    await userService.loadFrom({ userId: String(from?.id) });
    isAdmin = userService.current.isAdmin;
  } catch {}

  if (data.startsWith("up_e:") || data.startsWith("up_i:")) {
    try {
      if (!isAdmin) {
        await bot.answerCallbackQuery(query.id);
        return;
      }
      const actorName = from?.username ? `@${from.username}` : String(from?.id);
      if (data.startsWith("up_e:")) {
        const targetId = data.slice(5);
        if (db)
          await db.userProfile.updateMany({
            where: { id: targetId },
            data: { permissionLevel: 2 },
          });
        await bot.editMessageText(
          `${message.text}\n\n✓ <b>Enabled</b> by ${actorName}`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML" },
        );
        await bot.sendMessage(
          targetId,
          "Your access has been approved — you can now chat with me in private.",
        );
      } else {
        await bot.editMessageText(
          `${message.text}\n\n— <b>Ignored</b> by ${actorName}`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML" },
        );
      }
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error("[callback] promotion error:", err);
      await bot.answerCallbackQuery(query.id, { text: "Something went wrong" });
    }
    return;
  }

  if (!isAdmin) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  try {
    if (data.startsWith("mp:")) {
      const backendName = data.slice(3);
      const models = llm.models(backendName);
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
      const [, backendName, indexStr] = data.split(":");
      const modelName = llm.modelAt(backendName, parseInt(indexStr));
      if (modelName) {
        await llm.setActiveModel(backendName, modelName);
        await bot.editMessageText(
          `✓ Switched to <b>${backendName} / ${modelName}</b>`,
          { chat_id: chatId, message_id: messageId, parse_mode: "HTML" },
        );
        await bot.answerCallbackQuery(query.id, {
          text: `Now using ${modelName}`,
        });
      } else {
        await bot.answerCallbackQuery(query.id, { text: "Model not found" });
      }
    } else if (data === "mb") {
      await bot.editMessageText(
        `Current: <b>${llm.providerInfo()}</b>\n\nChoose a provider:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: backendRows(llm.availableBackends()),
          },
        },
      );
      await bot.answerCallbackQuery(query.id);
    }
  } catch (err) {
    console.error("[callback] error:", err);
    await bot.answerCallbackQuery(query.id, { text: "Something went wrong" });
  }
});

async function main() {
  startSubscriber(bot);

  await bot.setMyCommands(
    BOT_COMMANDS.map(({ command, description }) => ({ command, description })),
    { scope: { type: "all_private_chats" } },
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.services = createServiceContainer();
    next();
  });

  app.get("/archive/:hash", async (req, res) => {
    try {
      const thread = await req.services.get("thread").load(req.params.hash);
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
