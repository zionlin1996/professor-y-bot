const { SLASH_COMMANDS } = require("../constants/commands");

/**
 * Instantiatable service for the bot's control plane.
 *
 * Handles all slash commands and inline keyboard callbacks.
 * Replaces src/libs/preprocess.js and the callback_query handler in index.js.
 *
 * Dependencies injected via constructor:
 *   llm  — LLMService instance
 *   db   — Prisma client or null
 */
class BotControlService {
  constructor({ llm, db } = {}) {
    this._llm = llm;
    this._db = db;
  }

  use(bot) {
    this.bot = bot;
  }

  // ---------------------------------------------------------------------------
  // Command dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch a slash command from an IncomingMessage DTO.
   * Caller guarantees incoming.isCommand === true.
   * Group commands are silently ignored (all commands are PM-only).
   * Returns true if handled, false if the command is unknown.
   */
  async handleCommand(incoming) {
    // All commands are PM only — ignore in groups entirely
    if (incoming.isGroup) return false;

    const handler = this._commands()[incoming.command];
    if (!handler) return false;

    const reply = await handler(incoming);
    if (reply != null) {
      await this.bot.sendMessage(incoming.chatId, reply, {
        reply_to_message_id: incoming.id,
      });
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Callback query handler
  // ---------------------------------------------------------------------------

  /**
   * Handle an inline keyboard callback query.
   * Covers user promotion (up_e:/up_i:) and model switching (mp:/ms:/mb).
   */
  async handleCallback(query) {
    const { data, message, from } = query;

    // User promotion — any level-0 admin can act
    if (data.startsWith("up_e:") || data.startsWith("up_i:")) {
      try {
        if (!(await this._isAdmin(from?.id))) {
          await this.bot.answerCallbackQuery(query.id);
          return;
        }
        const actorName = from?.username
          ? `@${from.username}`
          : String(from?.id);
        if (data.startsWith("up_e:")) {
          const targetId = data.slice(5);
          if (this._db) {
            await this._db.userProfile.updateMany({
              where: { id: targetId },
              data: { permissionLevel: 2 },
            });
          }
          await this.bot.editMessageText(
            `${message.text}\n\n✓ <b>Enabled</b> by ${actorName}`,
            {
              chat_id: message.chat.id,
              message_id: message.message_id,
              parse_mode: "HTML",
            }
          );
          await this.bot.sendMessage(
            targetId,
            "Your access has been approved — you can now chat with me in private."
          );
        } else {
          await this.bot.editMessageText(
            `${message.text}\n\n— <b>Ignored</b> by ${actorName}`,
            {
              chat_id: message.chat.id,
              message_id: message.message_id,
              parse_mode: "HTML",
            }
          );
        }
        await this.bot.answerCallbackQuery(query.id);
      } catch (err) {
        console.error("[BotControlService] promotion callback error:", err);
        await this.bot.answerCallbackQuery(query.id, {
          text: "Something went wrong",
        });
      }
      return;
    }

    if (!(await this._isAdmin(from?.id))) {
      await this.bot.answerCallbackQuery(query.id);
      return;
    }

    const chatId = message.chat.id;
    const messageId = message.message_id;

    try {
      if (data.startsWith("mp:")) {
        const backendName = data.slice(3);
        const models = this._llm.models(backendName);
        const rows = models.map((m, i) => [
          { text: m, callback_data: `ms:${backendName}:${i}` },
        ]);
        rows.push([{ text: "← Back", callback_data: "mb" }]);
        await this.bot.editMessageText(
          `<b>${backendName}</b> — select a model:`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: rows },
          }
        );
        await this.bot.answerCallbackQuery(query.id);
      } else if (data.startsWith("ms:")) {
        const [, backendName, indexStr] = data.split(":");
        const modelName = this._llm.modelAt(backendName, parseInt(indexStr));
        if (modelName) {
          await this._llm.setActiveModel(backendName, modelName);
          await this.bot.editMessageText(
            `✓ Switched to <b>${backendName} / ${modelName}</b>`,
            { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }
          );
          await this.bot.answerCallbackQuery(query.id, {
            text: `Now using ${modelName}`,
          });
        } else {
          await this.bot.answerCallbackQuery(query.id, {
            text: "Model not found",
          });
        }
      } else if (data === "mb") {
        const rows = [];
        const groups = this._llm.availableBackends();
        for (let i = 0; i < groups.length; i += 2) {
          rows.push(
            groups.slice(i, i + 2).map((name) => ({
              text: name.charAt(0).toUpperCase() + name.slice(1),
              callback_data: `mp:${name}`,
            }))
          );
        }
        await this.bot.editMessageText(
          `Current: <b>${this._llm.providerInfo()}</b>\n\nChoose a provider:`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: rows },
          }
        );
        await this.bot.answerCallbackQuery(query.id);
      }
    } catch (err) {
      console.error("[BotControlService] callback error:", err);
      await this.bot.answerCallbackQuery(query.id, {
        text: "Something went wrong",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers (private)
  // ---------------------------------------------------------------------------

  async _isAdmin(userId) {
    if (!this._db || !userId) return false;
    try {
      const profile = await this._db.userProfile.findUnique({
        where: { id: String(userId) },
      });
      return profile?.permissionLevel === 0;
    } catch {
      return false;
    }
  }

  _guard(incoming) {
    if (!incoming.userId) return "Unable to identify you.";
    if (!this._db) return "Database not available.";
    return null;
  }

  // ---------------------------------------------------------------------------
  // Command handlers (private)
  // ---------------------------------------------------------------------------

  _commands() {
    const bot = this.bot;
    const llm = this._llm;
    const db = this._db;

    return {
      [SLASH_COMMANDS.START]: async (incoming) => {
        const err = this._guard(incoming);
        if (err) return err;
        const { userId, username, from } = incoming;
        const uid = String(userId);
        const displayName = username ? `@${username}` : from?.first_name || uid;

        const existing = await db.userProfile.findUnique({
          where: { id: uid },
        });
        if (existing)
          return "Your profile is already set up. Use /me to view your notes.";

        await db.userProfile.create({
          data: {
            id: uid,
            username: username || null,
          },
        });

        const admins = await db.userProfile.findMany({
          where: { permissionLevel: 0 },
        });
        if (admins.length > 0) {
          for (const admin of admins) {
            await bot.sendMessage(
              admin.id,
              `New user joined: ${displayName} (ID: <code>${uid}</code>)\nGrant PM access?`,
              {
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "✓ Enable",
                        callback_data: `up_e:${uid}`,
                      },
                      {
                        text: "✗ Ignore",
                        callback_data: `up_i:${uid}`,
                      },
                    ],
                  ],
                },
              }
            );
          }
        }
        return "Profile created! You'll be notified once your access is confirmed.";
      },

      [SLASH_COMMANDS.ME]: async (incoming) => {
        const err = this._guard(incoming);
        if (err) return err;
        const { id, chatId, userId, username } = incoming;

        const record = await db.userProfile.findUnique({
          where: { id: String(userId) },
        });
        const displayName = username ? `@${username}` : "your account";
        if (!record || !record.notes)
          return `No profile on record for ${displayName}.`;

        await bot.sendMessage(
          chatId,
          `<b>${displayName}'s profile:</b>\n\n${record.notes}`,
          { parse_mode: "HTML", reply_to_message_id: id }
        );
        return null;
      },

      [SLASH_COMMANDS.FORGET]: async (incoming) => {
        const err = this._guard(incoming);
        if (err) return err;
        const { userId, username } = incoming;
        const uid = String(userId);

        const record = await db.userProfile.findUnique({
          where: { id: uid },
        });
        const displayName = username ? `@${username}` : "your account";
        if (!record || !record.notes)
          return `No profile on record for ${displayName} — nothing to clear.`;

        await db.userProfile.update({
          where: { id: uid },
          data: { notes: "" },
        });
        return `Profile cleared for ${displayName}.`;
      },

      [SLASH_COMMANDS.STEALTH]: async (incoming) => {
        const err = this._guard(incoming);
        if (err) return err;
        const { userId, text } = incoming;

        const parts = text.trim().split(/\s+/);
        const arg = parts[1]?.toLowerCase();
        const enable = arg !== "off";

        const { count } = await db.userProfile.updateMany({
          where: { id: String(userId) },
          data: { stealthMode: enable },
        });
        if (count === 0)
          return "No profile found — run /start first to set up your profile.";
        return enable
          ? "Stealth mode ON — your messages will not be stored to the database."
          : "Stealth mode OFF — your messages will be stored normally.";
      },

      [SLASH_COMMANDS.MODEL]: async (incoming) => {
        const { chatId, userId } = incoming;
        if (!(await this._isAdmin(userId))) return llm.providerInfo();

        const groups = await llm.listModels();
        if (!groups.length) {
          await bot.sendMessage(
            chatId,
            "No models available — check your API keys."
          );
          return null;
        }

        const rows = [];
        for (let i = 0; i < groups.length; i += 2) {
          rows.push(
            groups.slice(i, i + 2).map((g) => ({
              text: g.backend.charAt(0).toUpperCase() + g.backend.slice(1),
              callback_data: `mp:${g.backend}`,
            }))
          );
        }
        await bot.sendMessage(
          chatId,
          `Current: <b>${llm.providerInfo()}</b>\n\nChoose a provider:`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } }
        );
        return null;
      },
    };
  }
}

module.exports = BotControlService;
