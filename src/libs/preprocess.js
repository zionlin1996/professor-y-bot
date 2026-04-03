/**
 * Group slash-command registry. Triggered via `@bot /command` after @mention is stripped.
 * Each handler receives the context object and returns a reply string (or null to suppress reply).
 */
const COMMANDS = {
  "/provider": ({ llm }) => llm.providerInfo(),
};

/**
 * Private chat command registry. Triggered by native Telegram bot commands (`/command`).
 * Only active in private chats.
 */
const REPLY_KEYBOARD = {
  keyboard: [[{ text: "🗑 Clear" }]],
  resize_keyboard: true,
  persistent: true,
};

const PRIVATE_COMMANDS = {
  "/start": async ({ bot, chatId }) => {
    await bot.sendMessage(chatId, "Hi! Send me a message to get started.", {
      reply_markup: REPLY_KEYBOARD,
    });
    return null;
  },
  "/clear": ({ privateThreads, chatId }) => {
    privateThreads.delete(chatId);
    return "Cleared.";
  },
  "🗑 Clear": ({ privateThreads, chatId }) => {
    privateThreads.delete(chatId);
    return "Cleared.";
  },
};

/**
 * Preprocess a message before it reaches the LLM.
 *
 * Returns the (possibly transformed) message to pass to the next stage,
 * or null/undefined if the message was fully handled here and LLM processing
 * should be skipped.
 *
 * @param {string|Array} message           - the resolved user message (text or content array)
 * @param {object}       ctx
 * @param {object}       ctx.msg           - Telegram message object
 * @param {object}       ctx.bot           - EnhancedBot instance
 * @param {object}       ctx.llm           - LLMClient instance
 * @param {number}       ctx.chatId
 * @param {boolean}      ctx.isGroup
 * @param {Map}          ctx.privateThreads
 * @returns {Promise<string|Array|null>}
 */
async function preprocess(message, ctx) {
  const { msg, bot, chatId, isGroup } = ctx;

  const text = typeof message === "string" ? message.trim() : "";
  const registry = isGroup ? COMMANDS : PRIVATE_COMMANDS;
  const handler = registry[text];

  if (!handler) return message;

  const reply = await handler(ctx);
  if (reply != null) {
    await bot.sendMessage(chatId, reply, {
      reply_to_message_id: msg.message_id,
    });
  }

  return null;
}

module.exports = preprocess;
