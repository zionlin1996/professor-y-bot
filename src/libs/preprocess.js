/**
 * Slash-command registry.
 * Each handler receives the context object and returns a reply string (or null to suppress reply).
 */
const COMMANDS = {
  "/provider": ({ llm }) => llm.providerInfo(),
};

/**
 * Preprocess a message before it reaches the LLM.
 *
 * Returns the (possibly transformed) message to pass to the next stage,
 * or null/undefined if the message was fully handled here and LLM processing
 * should be skipped.
 *
 * @param {string|Array} message      - the resolved user message (text or content array)
 * @param {object}       ctx
 * @param {object}       ctx.msg      - Telegram message object
 * @param {object}       ctx.bot      - EnhancedBot instance
 * @param {object}       ctx.llm      - LLMClient instance
 * @param {number}       ctx.chatId
 * @returns {Promise<string|Array|null>}
 */
async function preprocess(message, ctx) {
  const { msg, bot, chatId } = ctx;

  const text = typeof message === "string" ? message.trim() : "";
  const handler = COMMANDS[text];

  if (!handler) return message;

  const reply = handler(ctx);
  if (reply != null) {
    await bot.sendMessage(chatId, reply, {
      reply_to_message_id: msg.message_id,
    });
  }

  return null;
}

module.exports = preprocess;
