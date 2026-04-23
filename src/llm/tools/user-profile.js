const { getDb } = require("../../libs/db");

// Only register these tools when a database is configured.
// Profiles are keyed by Telegram userId (stored as `id`) — stable across username changes.
// The optional username field is stored for display and cross-user lookup only.
const enabled = !!process.env.DATABASE_URL;

const getDefinition = {
  name: "get_user_profile",
  description:
    "Retrieve the persistent Markdown profile notes for a user. " +
    "Omit 'username' to fetch the current user's profile. " +
    "Pass a Telegram username (without @) to look up another user's profile — useful when someone asks about another member of the group.",
  parameters: {
    type: "object",
    properties: {
      username: {
        type: "string",
        description:
          "The Telegram username (without @) of the user to look up. Omit to retrieve the current user's own profile.",
      },
    },
    required: [],
  },
};

const updateDefinition = {
  name: "update_user_profile",
  description:
    "Save updated Markdown profile notes for a user. " +
    "Omit 'username' to update the current user's profile. " +
    "Pass a Telegram username (without @) to update another user's profile — use this when the conversation is about or involves another member.",
  parameters: {
    type: "object",
    properties: {
      notes: {
        type: "string",
        description:
          "The full updated Markdown profile text. Use bullet points grouped by topic. Example:\n- Name: prefers 'Alex'\n- Language: English\n- Interests: climbing, coffee",
      },
      username: {
        type: "string",
        description:
          "The Telegram username (without @) of the user whose profile to update. Omit to update the current user's own profile.",
      },
    },
    required: ["notes"],
  },
};

/**
 * @param {object} args
 * @param {{ chatId: number, userId: number, username?: string }} context
 */
async function getProfile({ username: targetUsername } = {}, { userId: currentUserId, username: currentUsername } = {}) {
  const db = getDb();
  if (!db) return "Database not available.";

  if (targetUsername) {
    // Cross-user lookup by username
    const record = await db.userProfile.findUnique({ where: { username: targetUsername } });
    return record?.notes || `No profile found for @${targetUsername}.`;
  }

  if (!currentUserId) return "User identity unavailable.";
  const record = await db.userProfile.findUnique({ where: { id: String(currentUserId) } });
  return record?.notes || `No profile found for ${currentUsername ? `@${currentUsername}` : "you"}.`;
}

/**
 * @param {{ notes: string, username?: string }} args
 * @param {{ chatId: number, userId: number, username?: string }} context
 */
async function updateProfile({ notes, username: targetUsername }, { userId: currentUserId, username: currentUsername } = {}) {
  const db = getDb();
  if (!db) return "Database not available.";

  if (targetUsername) {
    // Cross-user update — only works if they already have a profile (no userId available to the LLM)
    const existing = await db.userProfile.findUnique({ where: { username: targetUsername } });
    if (!existing) return `No profile found for @${targetUsername} — they need to interact with the bot first.`;
    await db.userProfile.update({
      where: { username: targetUsername },
      data: { notes },
    });
    return "Profile updated successfully.";
  }

  if (!currentUserId) return "User identity unavailable.";
  const id = String(currentUserId);
  await db.userProfile.upsert({
    where: { id },
    update: { notes, ...(currentUsername ? { username: currentUsername } : {}) },
    create: { id, username: currentUsername || null, notes },
  });

  return "Profile updated successfully.";
}

module.exports = {
  enabled,
  getDefinition,
  updateDefinition,
  getProfile,
  updateProfile,
};
