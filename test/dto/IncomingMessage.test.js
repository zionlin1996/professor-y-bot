const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const IncomingMessage = require("../../src/dto/IncomingMessage");
const { INLINE_COMMANDS } = require("../../src/constants/commands");

const BOT = "testbot";

before(() => {
  process.env.TELEGRAM_BOT_USERNAME = BOT;
});

after(() => {
  delete process.env.TELEGRAM_BOT_USERNAME;
});

function makeMsg(overrides = {}) {
  return {
    message_id: 1,
    chat: { id: 100, type: "private" },
    from: { id: 42, username: "alice" },
    text: "hello",
    ...overrides,
  };
}

function makeGroup(overrides = {}) {
  return makeMsg({ chat: { id: 200, type: "group" }, ...overrides });
}

// ── isGroup / isPrivate ───────────────────────────────────────────────────────

describe("isGroup / isPrivate", () => {
  it("private chat sets isPrivate=true isGroup=false", () => {
    const msg = new IncomingMessage(makeMsg());
    assert.equal(msg.isGroup, false);
    assert.equal(msg.isPrivate, true);
  });

  it("group chat sets isGroup=true isPrivate=false", () => {
    const msg = new IncomingMessage(makeGroup());
    assert.equal(msg.isGroup, true);
    assert.equal(msg.isPrivate, false);
  });

  it("supergroup is treated as group", () => {
    const msg = new IncomingMessage(
      makeMsg({ chat: { id: 300, type: "supergroup" } }),
    );
    assert.equal(msg.isGroup, true);
  });
});

// ── isForwarded ───────────────────────────────────────────────────────────────

describe("isForwarded", () => {
  it("false when forward_origin is absent", () => {
    const msg = new IncomingMessage(makeMsg());
    assert.equal(msg.isForwarded, false);
  });

  it("true when forward_origin is set", () => {
    const msg = new IncomingMessage(makeMsg({ forward_origin: { type: "user" } }));
    assert.equal(msg.isForwarded, true);
  });
});

// ── isValid ───────────────────────────────────────────────────────────────────

describe("isValid", () => {
  it("true for a normal text message", () => {
    const msg = new IncomingMessage(makeMsg());
    assert.equal(msg.isValid, true);
  });

  it("false when forwarded", () => {
    const msg = new IncomingMessage(makeMsg({ forward_origin: { type: "user" } }));
    assert.equal(msg.isValid, false);
  });

  it("false when text contains the keyword filter", () => {
    const msg = new IncomingMessage(makeMsg({ text: "白爛+1 haha" }));
    assert.equal(msg.isValid, false);
  });

  it("false when caption contains the keyword filter", () => {
    const msg = new IncomingMessage(makeMsg({ text: undefined, caption: "白爛+1" }));
    assert.equal(msg.isValid, false);
  });

  it("false when no text, caption, photo, document, or sticker", () => {
    const msg = new IncomingMessage(makeMsg({ text: undefined }));
    assert.equal(msg.isValid, false);
  });

  it("true when message has a photo (no text required)", () => {
    const raw = makeMsg({ text: undefined, photo: [{ file_id: "p1" }] });
    const msg = new IncomingMessage(raw);
    assert.equal(msg.isValid, true);
  });

  it("true when message has a document", () => {
    const raw = makeMsg({
      text: undefined,
      document: { file_id: "d1", mime_type: "image/png" },
    });
    const msg = new IncomingMessage(raw);
    assert.equal(msg.isValid, true);
  });

  it("true when message has a sticker", () => {
    const raw = makeMsg({
      text: undefined,
      sticker: { file_id: "s1", thumbnail: { file_id: "t1" } },
    });
    const msg = new IncomingMessage(raw);
    assert.equal(msg.isValid, true);
  });
});

// ── rawContent ────────────────────────────────────────────────────────────────

describe("rawContent", () => {
  it("returns text when present", () => {
    const msg = new IncomingMessage(makeMsg({ text: "hi" }));
    assert.equal(msg.rawContent, "hi");
  });

  it("returns caption when text is absent", () => {
    const msg = new IncomingMessage(makeMsg({ text: undefined, caption: "a caption" }));
    assert.equal(msg.rawContent, "a caption");
  });

  it("returns empty string when neither present", () => {
    const msg = new IncomingMessage(makeMsg({ text: undefined }));
    assert.equal(msg.rawContent, "");
  });
});

// ── isMention ─────────────────────────────────────────────────────────────────

describe("isMention", () => {
  it("true when raw text contains @botname", () => {
    const msg = new IncomingMessage(makeMsg({ text: `hey @${BOT} help` }));
    assert.equal(msg.isMention, true);
  });

  it("false when @botname is absent", () => {
    const msg = new IncomingMessage(makeMsg({ text: "hey help" }));
    assert.equal(msg.isMention, false);
  });

  it("checks raw text before inline-command stripping", () => {
    const msg = new IncomingMessage(
      makeMsg({ text: `@${BOT} !info something` }),
    );
    assert.equal(msg.isMention, true);
  });
});

// ── isCommand / command ───────────────────────────────────────────────────────

describe("isCommand / command", () => {
  it("false when no entities", () => {
    const msg = new IncomingMessage(makeMsg());
    assert.equal(msg.isCommand, false);
    assert.equal(msg.command, null);
  });

  it("true when bot_command entity at offset 0", () => {
    const msg = new IncomingMessage(
      makeMsg({
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      }),
    );
    assert.equal(msg.isCommand, true);
    assert.equal(msg.command, "/start");
  });

  it("strips @botname suffix from command", () => {
    const msg = new IncomingMessage(
      makeMsg({
        text: `/model@${BOT}`,
        entities: [{ type: "bot_command", offset: 0, length: `/model@${BOT}`.length }],
      }),
    );
    assert.equal(msg.command, "/model");
  });

  it("false when bot_command entity is not at offset 0", () => {
    const msg = new IncomingMessage(
      makeMsg({
        text: "say /start",
        entities: [{ type: "bot_command", offset: 4, length: 6 }],
      }),
    );
    assert.equal(msg.isCommand, false);
  });
});

// ── inline commands ───────────────────────────────────────────────────────────

describe("inline commands", () => {
  it("!noreply is detected and stripped from text", () => {
    const msg = new IncomingMessage(makeMsg({ text: "hello !noreply world" }));
    assert.equal(msg.inlineCommand(INLINE_COMMANDS.NOREPLY), true);
    assert.equal(msg.text.includes("!noreply"), false);
    // Token is replaced with empty string; surrounding spaces may remain
    assert.ok(msg.text.includes("hello"), "text should still include surrounding words");
    assert.ok(msg.text.includes("world"), "text should still include surrounding words");
  });

  it("!info is detected and stripped from text", () => {
    const msg = new IncomingMessage(makeMsg({ text: "!info what is this?" }));
    assert.equal(msg.inlineCommand(INLINE_COMMANDS.INFO), true);
    assert.equal(msg.text.includes("!info"), false);
  });

  it("both tokens can coexist", () => {
    const msg = new IncomingMessage(makeMsg({ text: "!noreply !info test" }));
    assert.equal(msg.inlineCommand(INLINE_COMMANDS.NOREPLY), true);
    assert.equal(msg.inlineCommand(INLINE_COMMANDS.INFO), true);
    assert.equal(msg.text.trim(), "test");
  });

  it("returns false for absent token", () => {
    const msg = new IncomingMessage(makeMsg({ text: "normal message" }));
    assert.equal(msg.inlineCommand(INLINE_COMMANDS.NOREPLY), false);
    assert.equal(msg.inlineCommand(INLINE_COMMANDS.INFO), false);
  });
});

// ── senderPrefix ──────────────────────────────────────────────────────────────

describe("senderPrefix", () => {
  it("uses @username when available", () => {
    const msg = new IncomingMessage(makeMsg({ from: { id: 1, username: "alice" } }));
    assert.equal(msg.senderPrefix, "@alice: ");
  });

  it("uses first_name + id when username is absent", () => {
    const msg = new IncomingMessage(makeMsg({ from: { id: 99, first_name: "Bob" } }));
    assert.equal(msg.senderPrefix, "Bob (id:99): ");
  });

  it("falls back to 'User' when first_name is also absent", () => {
    const msg = new IncomingMessage(makeMsg({ from: { id: 7 } }));
    assert.equal(msg.senderPrefix, "User (id:7): ");
  });
});

// ── mentionStrippedText ───────────────────────────────────────────────────────

describe("mentionStrippedText", () => {
  it("removes @botname from text", () => {
    const msg = new IncomingMessage(makeMsg({ text: `@${BOT} what's up` }));
    assert.equal(msg.mentionStrippedText, "what's up");
  });

  it("removes all occurrences of @botname", () => {
    const msg = new IncomingMessage(
      makeMsg({ text: `@${BOT} hello @${BOT}` }),
    );
    assert.ok(!msg.mentionStrippedText.includes(`@${BOT}`));
  });

  it("is empty string when only @botname in text", () => {
    const msg = new IncomingMessage(makeMsg({ text: `@${BOT}` }));
    assert.equal(msg.mentionStrippedText, "");
  });
});

// ── quotedPrompt ──────────────────────────────────────────────────────────────

describe("quotedPrompt", () => {
  it("returns mentionStrippedText when there is no reply", () => {
    const msg = new IncomingMessage(makeMsg({ text: `@${BOT} hi` }));
    assert.equal(msg.quotedPrompt, "hi");
  });

  it("formats reply as '> original\\n\\nreplyContent'", () => {
    const raw = makeMsg({
      text: `@${BOT} my reply`,
      reply_to_message: { message_id: 5, text: "original message" },
    });
    const msg = new IncomingMessage(raw);
    assert.equal(msg.quotedPrompt, "> original message\n\nmy reply");
  });

  it("returns original text only when reply content is empty (just @mention)", () => {
    const raw = makeMsg({
      text: `@${BOT}`,
      reply_to_message: { message_id: 5, text: "original message" },
    });
    const msg = new IncomingMessage(raw);
    assert.equal(msg.quotedPrompt, "original message");
  });

  it("uses caption from replied-to message when text is absent", () => {
    const raw = makeMsg({
      text: `@${BOT} comment`,
      reply_to_message: { message_id: 5, caption: "photo caption" },
    });
    const msg = new IncomingMessage(raw);
    assert.equal(msg.quotedPrompt, "> photo caption\n\ncomment");
  });
});

// ── replyToId / replyToMessage ────────────────────────────────────────────────

describe("replyToId / replyToMessage", () => {
  it("null when no reply", () => {
    const msg = new IncomingMessage(makeMsg());
    assert.equal(msg.replyToId, null);
    assert.equal(msg.replyToMessage, null);
  });

  it("set to string message_id when reply present", () => {
    const raw = makeMsg({
      reply_to_message: { message_id: 77, text: "original" },
    });
    const msg = new IncomingMessage(raw);
    assert.equal(msg.replyToId, "77");
    assert.deepEqual(msg.replyToMessage, { message_id: 77, text: "original" });
  });
});

// ── targetAttachment ──────────────────────────────────────────────────────────

describe("targetAttachment", () => {
  it("null when no attachment anywhere", () => {
    const msg = new IncomingMessage(makeMsg());
    assert.equal(msg.targetAttachment, null);
  });

  it("returns photo from current message", () => {
    const raw = makeMsg({
      photo: [{ file_id: "small" }, { file_id: "large" }],
    });
    const msg = new IncomingMessage(raw);
    assert.deepEqual(msg.targetAttachment, { file_id: "large" });
  });

  it("falls back to photo in reply when current message has none", () => {
    const raw = makeMsg({
      reply_to_message: {
        message_id: 5,
        text: "look",
        photo: [{ file_id: "reply_photo" }],
      },
    });
    const msg = new IncomingMessage(raw);
    assert.deepEqual(msg.targetAttachment, { file_id: "reply_photo" });
  });

  it("current message attachment takes priority over reply attachment", () => {
    const raw = makeMsg({
      photo: [{ file_id: "current_photo" }],
      reply_to_message: {
        message_id: 5,
        text: "look",
        photo: [{ file_id: "reply_photo" }],
      },
    });
    const msg = new IncomingMessage(raw);
    assert.deepEqual(msg.targetAttachment, { file_id: "current_photo" });
  });
});
