const SLASH_COMMANDS = {
  START: "/start",
  MODEL: "/model",
  ME: "/me",
  FORGET: "/forget",
  STEALTH: "/stealth",
};

const INLINE_COMMANDS = {
  NOREPLY: "!noreply",
  INFO: "!info",
};

/**
 * Bot commands registered with Telegram via setMyCommands on startup.
 * Each entry: { command, description, scope } where scope is a Telegram BotCommandScope object.
 */
const BOT_COMMANDS = [
  { command: "start", description: "Set up your profile with the bot" },
  { command: "model", description: "Show current AI model; switch provider and model (admin only)" },
  { command: "me", description: "Show your saved profile notes" },
  { command: "forget", description: "Clear your saved profile notes" },
  { command: "stealth", description: "Toggle stealth mode — messages are not stored to DB when on" },
];

module.exports = { SLASH_COMMANDS, INLINE_COMMANDS, BOT_COMMANDS };
