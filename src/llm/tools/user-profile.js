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
    "Pass a Telegram username (without @) to look up another user's profile — useful when someone asks about another member of the group. " +
    "Returns three possible states: NOT_REGISTERED (no record exists), EMPTY_PROFILE (registered but no notes saved), or the notes themselves.",
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
  description: "Save updated Markdown profile notes for the current user.",
  parameters: {
    type: "object",
    properties: {
      notes: {
        type: "string",
        description:
          "The full updated Markdown profile text. Use bullet points grouped by topic. Example:\n- Name: prefers 'Alex'\n- Language: English\n- Interests: climbing, coffee",
      },
    },
    required: ["notes"],
  },
};

/**
 * @param {object} args
 * @param {{ chatId: number, userId: number, username?: string }} context
 * 
 * Returns one of three states:
 * - "NOT_REGISTERED:..." if user has never run /start
 * - "EMPTY_PROFILE:..." if user is registered but has no notes saved
 * - The notes themselves if they exist
 */
async function getProfile({ username: targetUsername } = {}, { userId: currentUserId, username: currentUsername } = {}) {
  const db = getDb();
  if (!db) return "Database not available.";

  if (targetUsername) {
    // Cross-user lookup by username
    const record = await db.userProfile.findUnique({ where: { username: targetUsername } });
    if (!record) {
      return `NOT_REGISTERED: @${targetUsername} has not run /start yet.`;
    }
    if (!record.notes || record.notes.trim() === "") {
      return `EMPTY_PROFILE: @${targetUsername} is registered but has no notes saved yet.`;
    }
    return record.notes;
  }

  if (!currentUserId) return "User identity unavailable.";
  const record = await db.userProfile.findUnique({ where: { id: String(currentUserId) } });
  
  if (!record) {
    return `NOT_REGISTERED: ${currentUsername ? `@${currentUsername}` : "You"} has not run /start yet.`;
  }
  if (!record.notes || record.notes.trim() === "") {
    return `EMPTY_PROFILE: ${currentUsername ? `@${currentUsername}` : "You"} is registered but has no notes saved yet.`;
  }
  return record.notes;
}

/**
 * @param {{ notes: string }} args
 * @param {{ chatId: number, userId: number, username?: string }} context
 */
async function updateProfile({ notes }, { userId: currentUserId } = {}) {
  const db = getDb();
  if (!db) return "Database not available.";
  if (!currentUserId) return "User identity unavailable.";

  const { count } = await db.userProfile.updateMany({
    where: { id: String(currentUserId) },
    data: { notes },
  });

  if (count === 0) return "No profile found — ask the user to run /start first before I can save notes for them.";
  return "Profile updated successfully.";
}

module.exports = {
  enabled,
  getDefinition,
  updateDefinition,
  getProfile,
  updateProfile,
};
