const { SLASH_COMMANDS } = require("../constants/commands");
const { getDb } = require("./db");
const { getStealthMode, setStealthMode } = require("./userPreference");

const ADMIN_USERNAME = "yanglin1112";

/**
 * Command registry for standard Telegram bot commands.
 * Triggered by sending /command in any chat (or /command@botname in groups).
 * Handlers may be async; returning null suppresses the default reply
 * (use this when the handler sends its own message).
 */
const COMMANDS = {
  [SLASH_COMMANDS.START]: async ({ msg, bot }) => {
    const userId = msg.from?.id;
    if (!userId) return "Unable to identify you.";

    const db = getDb();
    if (!db) return "Database not available.";

    const existing = await db.userProfile.findUnique({ where: { id: String(userId) } });
    if (existing) return "Your profile is already set up. Use /me to view your notes.";

    await db.userProfile.create({
      data: { id: String(userId), username: msg.from?.username || null },
    });

    // Notify all admins (level 0) about the new user
    const admins = await db.userProfile.findMany({ where: { permissionLevel: 0 } });
    if (admins.length > 0) {
      const displayName = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || String(userId);
      for (const admin of admins) {
        await bot.sendMessage(
          admin.id,
          `New user joined: ${displayName} (ID: <code>${userId}</code>)\nGrant PM access?`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "✓ Enable", callback_data: `up_e:${userId}` },
                { text: "✗ Ignore", callback_data: `up_i:${userId}` },
              ]],
            },
          },
        );
      }
    }

    return "Profile created! You'll be notified once your access is confirmed.";
  },

  [SLASH_COMMANDS.ME]: async ({ msg, bot, chatId }) => {
    const userId = msg.from?.id;
    const username = msg.from?.username;
    if (!userId) return "Unable to look up your profile.";

    const db = getDb();
    if (!db) return "Database not available.";

    const record = await db.userProfile.findUnique({ where: { id: String(userId) } });
    const displayName = username ? `@${username}` : "your account";
    if (!record || !record.notes)
      return `No profile on record for ${displayName}.`;

    await bot.sendMessage(
      chatId,
      `<b>${displayName}'s profile:</b>\n\n${record.notes}`,
      { parse_mode: "HTML", reply_to_message_id: msg.message_id },
    );
    return null;
  },

  [SLASH_COMMANDS.FORGET]: async ({ msg }) => {
    const userId = msg.from?.id;
    const username = msg.from?.username;
    if (!userId) return "Unable to find your profile.";

    const db = getDb();
    if (!db) return "Database not available.";

    const record = await db.userProfile.findUnique({ where: { id: String(userId) } });
    const displayName = username ? `@${username}` : "your account";
    if (!record || !record.notes)
      return `No profile on record for ${displayName} — nothing to clear.`;

    await db.userProfile.update({
      where: { id: String(userId) },
      data: { notes: "" },
    });

    return `Profile cleared for ${displayName}.`;
  },

  [SLASH_COMMANDS.STEALTH]: async ({ msg }) => {
    const userId = msg.from?.id;
    if (!userId) return "Unable to toggle stealth mode.";

    const db = getDb();
    if (!db) return "Database not available.";

    const parts = msg.text.trim().split(/\s+/);
    const arg = parts[1]?.toLowerCase();
    const enable = arg !== "off";

    const updated = await setStealthMode(userId, enable);
    if (!updated) return "No profile found — run /start first to set up your profile.";
    return enable
      ? "Stealth mode ON — your messages will not be stored to the database."
      : "Stealth mode OFF — your messages will be stored normally.";
  },

  [SLASH_COMMANDS.MODEL]: async ({ msg, bot, chatId, llm }) => {
    if (msg.from?.username !== ADMIN_USERNAME) {
      return llm.providerInfo();
    }

    const groups = await llm.listModels();
    if (!groups.length) {
      await bot.sendMessage(
        chatId,
        "No models available — check your API keys.",
      );
      return null;
    }

    const rows = [];
    for (let i = 0; i < groups.length; i += 2) {
      rows.push(
        groups.slice(i, i + 2).map((g) => ({
          text: g.backend.charAt(0).toUpperCase() + g.backend.slice(1),
          callback_data: `mp:${g.backend}`,
        })),
      );
    }

    await bot.sendMessage(
      chatId,
      `Current: <b>${llm.providerInfo()}</b>\n\nChoose a provider:`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } },
    );
    return null;
  },
};

/**
 * Detect and dispatch a standard Telegram bot command from the message entities.
 * Must be called before any thread/mention routing so commands bypass the LLM flow.
 *
 * Returns true if a command was handled (caller should stop processing),
 * false if the message is not a bot command or no handler is registered for it.
 *
 * In groups, commands addressed to another bot (/cmd@otherbot) are ignored.
 *
 * @param {object}  ctx
 * @param {object}  ctx.msg
 * @param {object}  ctx.bot
 * @param {object}  ctx.llm
 * @param {number}  ctx.chatId
 * @param {boolean} ctx.isGroup
 * @returns {Promise<boolean>}
 */
async function preprocess(ctx) {
  const { msg, bot, chatId, isGroup } = ctx;

  const commandEntity = msg.entities?.find(
    (e) => e.type === "bot_command" && e.offset === 0,
  );
  if (!commandEntity) return false;

  const raw = msg.text.slice(0, commandEntity.length); // e.g. "/model" or "/model@botname"
  const [command, addressee] = raw.split("@");

  // All commands are PM only
  if (isGroup) return false;

  const handler = COMMANDS[command];
  if (!handler) return false;

  const reply = await handler(ctx);
  if (reply != null) {
    await bot.sendMessage(chatId, reply, {
      reply_to_message_id: msg.message_id,
    });
  }
  return true;
}

module.exports = preprocess;
