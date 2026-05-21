const bakiData = require("../extensions/baki-memes.json");

// Build flat index once at require time
const entries = [];
for (const [section, items] of Object.entries(bakiData.sections)) {
  for (const item of items) {
    entries.push({ caption: item.caption, url: item.url, section });
  }
}

// Compact numbered list for the LLM prompt — built once, reused every call
const CAPTION_LIST = entries
  .map((e, i) => `${i + 1}. [${e.section}] ${e.caption}`)
  .join("\n");

const SELECTION_PROMPT = `You are selecting the best matching Baki meme panel for a description.
Return ONLY a single integer: the number of the best matching caption (1–${entries.length}), or 0 if nothing fits well.
No explanation. No other text. Just the number.

Captions:
${CAPTION_LIST}`;

async function findBestMatch(description, backend) {
  const messages = [
    {
      role: "user",
      content: `${SELECTION_PROMPT}\n\nDescription: ${description}`,
    },
  ];

  const reply = await backend.complete(messages);
  const num = parseInt(reply.trim(), 10);

  if (!num || num < 1 || num > entries.length) return null;
  return entries[num - 1];
}

module.exports = { findBestMatch };
