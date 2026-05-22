const mygoData = require("../extensions/mygo-memes.json");

// Build flat index once at require time
const entries = [];
for (const [section, items] of Object.entries(mygoData.sections)) {
  for (const item of items) {
    entries.push({ alt: item.alt, url: item.url, section, episode: item.episode, tags: item.tags });
  }
}

const CAPTION_LIST = entries
  .map((e, i) => `${i + 1}. [${e.section}] ${e.alt}`)
  .join("\n");

const SELECTION_PROMPT = `You are selecting the best matching MyGO anime meme panel for a description.
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
