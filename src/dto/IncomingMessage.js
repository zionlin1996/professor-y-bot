const { getLastImage } = require("../libs/attachments");
const { INLINE_COMMANDS } = require("../constants/commands");

/**
 * Pure DTO for a Telegram message. No I/O, no async.
 * Eagerly parses all fields (including text + inline command tokens) on construction.
 */
class IncomingMessage {
  constructor(rawMsg) {
    this._raw = rawMsg;

    this.id = String(rawMsg.message_id);
    this.chatId = String(rawMsg.chat.id) || "";
    this.userId = String(rawMsg.from?.id) || "";
    this.username = rawMsg.from?.username;
    this.from = rawMsg.from;
    this.isGroup =
      rawMsg.chat.type === "group" || rawMsg.chat.type === "supergroup";
    this.isPrivate = !this.isGroup;
    this.isForwarded = !!rawMsg.forward_origin;
    this.replyToId = rawMsg.reply_to_message
      ? String(rawMsg.reply_to_message.message_id)
      : null;
    this.replyToMessage = rawMsg.reply_to_message ?? null;
    this.command = this._parseCommand() ?? null;

    const { text, inlineCommands } = this._parseText();
    this.text = text;
    this._inlineCommands = inlineCommands;
  }

  /** Raw text or caption from the message, before any processing. */
  get rawContent() {
    return this._raw.text || this._raw.caption || "";
  }

  /** False if forwarded, keyword-filtered, or has no content. */
  get isValid() {
    if (this.isForwarded) return false;
    const { text, caption, photo, document, sticker } = this._raw;
    if (this.rawContent.includes("白爛+1")) return false;
    if (!text && !caption && !photo && !document && !sticker) return false;
    return true;
  }

  /** True if the raw text contains @botUsername. Checked against raw text (pre-strip). */
  get isMention() {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    return this.rawContent.includes(`@${botUsername}`);
  }

  /** True if a bot_command entity exists at offset 0. */
  get isCommand() {
    return this.command !== null;
  }

  /**
   * Check whether an inline command token (!noreply, !info) was present in the message.
   * e.g. incoming.inlineCommand(INLINE_COMMANDS.INFO)
   */
  inlineCommand(token) {
    return this._inlineCommands.has(token);
  }

  _parseText() {
    const inlineCommands = new Set();
    let text = this.rawContent;
    for (const token of Object.values(INLINE_COMMANDS)) {
      if (!text.includes(token)) continue;
      inlineCommands.add(token);
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(escaped, "g"), "").trim();
    }
    return { text, inlineCommands };
  }

  /** "@username: " prefix for LLM context. Falls back to first_name then "user". */
  get senderPrefix() {
    const name = this.from?.username || this.from?.first_name || "user";
    return `@${name}: `;
  }

  /** Message text with @botUsername stripped. */
  get mentionStrippedText() {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    return this.text.replace(new RegExp(`@${botUsername}`, "g"), "").trim();
  }

  /**
   * Builds the prompt for a fresh @mention thread.
   * If the message is a reply: "> originalText\n\nreplyContent"
   * Otherwise: mentionStrippedText
   */
  get quotedPrompt() {
    if (!this.replyToMessage) return this.mentionStrippedText;
    const originalText =
      this.replyToMessage.text || this.replyToMessage.caption || "";
    const replyContent = this.mentionStrippedText;
    return replyContent ? `> ${originalText}\n\n${replyContent}` : originalText;
  }

  /** Current message attachment takes priority over replied-to attachment. */
  get targetAttachment() {
    return getLastImage(this._raw) || getLastImage(this.replyToMessage);
  }

  _parseCommand() {
    const entity = this._raw.entities?.find(
      (e) => e.type === "bot_command" && e.offset === 0,
    );
    if (!entity) return null;
    const full = (this._raw.text || "").slice(
      entity.offset,
      entity.offset + entity.length,
    );
    return full.split("@")[0];
  }
}

module.exports = IncomingMessage;
