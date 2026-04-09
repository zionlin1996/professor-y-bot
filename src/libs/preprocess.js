const Thread = require("../llm/Thread");

/**
 * Command registry. Triggered via `@bot /command` in groups (after @mention is stripped)
 * or `/command` in private chats. Handlers may be async; returning null suppresses the
 * default reply (use this when the handler sends its own message).
 */
const COMMANDS = {
  "/provider": ({ llm }) => llm.providerInfo(),

  "/export": async ({ msg }) => {
    const replyToId = msg.reply_to_message?.message_id;
    const thread = replyToId ? await Thread.resolve(replyToId) : null;

    if (!thread || thread.history.length === 0) {
      return "Nothing to export. Reply to a message in the conversation thread you want to export.";
    }

    const hash = await thread.archive();
    const base = process.env.EXTERNAL_URL || "http://localhost";
    return `${base}/archive/${hash}`;
  },
};

/**
 * Preprocess a message before it reaches the LLM.
 *
 * Returns the (possibly transformed) message to pass to the next stage,
 * or null/undefined if the message was fully handled here and LLM processing
 * should be skipped.
 *
 * @param {string|Array} message - the resolved user message (text or content array)
 * @param {object}       ctx
 * @param {object}       ctx.msg     - Telegram message object
 * @param {object}       ctx.bot     - EnhancedBot instance
 * @param {object}       ctx.llm     - LLMClient instance
 * @param {number}       ctx.chatId
 * @param {boolean}      ctx.isGroup
 * @returns {Promise<string|Array|null>}
 */
async function preprocess(message, ctx) {
  const { msg, bot, chatId } = ctx;

  const text = typeof message === "string" ? message.trim() : "";
  const handler = COMMANDS[text];

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
