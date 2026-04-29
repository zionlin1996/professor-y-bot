/**
 * Immutable DTO representing a fully-resolved user prompt ready for the LLM pipeline.
 * Built by UserService.createPrompt() — never construct directly in index.js.
 *
 * text      — clean text for DB storage (bot mention stripped, no sender prefix)
 * content   — LLM-ready message content: prefixed string, or [{type:"text"},{type:"image"}]
 * attachment — { fileId, mediaType } for DB metadata, or null
 * userId    — Telegram user ID string
 * username  — Telegram username or undefined
 * messageId — Telegram message ID string (for DB-native thread resolution)
 */
class Prompt {
  constructor({ text, content, attachment, userId, username, messageId }) {
    this.text = text;
    this.content = content;
    this.attachment = attachment;
    this.userId = userId;
    this.username = username;
    this.messageId = messageId;
  }

  /** True when there is nothing to send to the LLM. */
  get isEmpty() {
    return !this.content && !this.attachment;
  }
}

module.exports = Prompt;
