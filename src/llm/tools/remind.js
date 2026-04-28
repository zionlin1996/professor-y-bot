const { fetch } = require("undici");
// @todo: make SCHEDULER_URL configurable via env var
const SCHEDULER_URL = "http://srv-captain--scheduler";

// @todo: make this configurable if tool should be conditionally disabled
const enabled = true;

const definition = {
  name: "schedule_reminder",
  description:
    "Schedule a reminder message to be delivered to the user at a specific future time. " +
    "Use this whenever the user asks to be reminded of something later.",
  parameters: {
    type: "object",
    properties: {
      deliver_at: {
        type: "string",
        description: "ISO 8601 UTC timestamp for when to deliver the reminder (e.g. 2026-04-03T18:00:00Z)",
      },
      text: {
        type: "string",
        description: "The reminder message to send to the user",
      },
    },
    required: ["deliver_at", "text"],
  },
};

/**
 * Execute the schedule_reminder tool call.
 * @param {{ deliver_at: string, text: string }} args
 * @param {number} chatId - Telegram chat ID to deliver the reminder to
 * @returns {Promise<string>} - result string to return to the LLM
 */
async function execute({ deliver_at, text }, { chatId } = {}) {
  const res = await fetch(`${SCHEDULER_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deliver_at,
      channel: "notifications",
      payload: { chat_id: chatId, text },
    }),
  });

  if (!res.ok) throw new Error(`scheduler returned ${res.status}`);

  const { job_id } = await res.json();
  const deliverAt = new Date(deliver_at);
  return `Reminder scheduled for ${deliverAt.toUTCString()} (job_id: ${job_id})`;
}

module.exports = { enabled, definition, execute };
