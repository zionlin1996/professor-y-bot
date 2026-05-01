const { toImageBlock } = require("../libs/attachments");
const Prompt = require("../dto/Prompt");

const GUEST_USER = {
  isRestricted: true,
  isGuest: true,
  stealth: false,
  permissionLevel: null,
};

class UserService {
  constructor({ db } = {}) {
    this._db = db;
    this.current = null;
    this.incoming = null;
  }

  async loadFrom(incoming) {
    this.incoming = incoming;
    if (!this._db || !incoming.userId) throw new Error("Corrupted user data");
    const profile = await this._db.userProfile.findUnique({
      where: { id: incoming.userId },
    });
    if (!profile) {
      this.current = GUEST_USER;
      return this.current;
    }
    this.current = {
      ...profile,
      stealth: profile.stealthMode,
      isGuest: false,
      isRestricted:
        profile.permissionLevel === null || profile.permissionLevel === 1,
    };
    return this.current;
  }

  /**
   * Build a Prompt DTO from the message set by from().
   * Strips the bot mention, resolves any image attachment, and assembles
   * both the clean DB text and the LLM-ready content with sender prefix.
   */
  async createPrompt() {
    if (!this.incoming)
      throw new Error("Call loadFrom() before createPrompt()");
    const incoming = this.incoming;

    // text: stored in DB — mention stripped, no sender prefix
    const dbText = incoming.mentionStrippedText;
    // llmText: sent to the LLM — includes quoted reply context when starting a new thread
    const llmText = incoming.quotedPrompt;

    let imageBlock = null;
    let attachment = null;
    const telegramFile = incoming.targetAttachment;
    if (telegramFile) {
      imageBlock = await toImageBlock(telegramFile);
      attachment = {
        fileId: telegramFile.file_id,
        mediaType: imageBlock.mediaType,
      };
    }

    const displayText =
      llmText || (imageBlock ? "What is in this image?" : null);
    let content = null;
    if (imageBlock) {
      content = [
        { type: "text", text: incoming.senderPrefix + displayText },
        imageBlock,
      ];
    } else if (displayText) {
      content = incoming.senderPrefix + displayText;
    }

    return new Prompt({
      text: dbText,
      content,
      attachment,
      userId: this.current.userId,
      username: incoming.username,
      messageId: String(incoming.id),
    });
  }
}

module.exports = UserService;
