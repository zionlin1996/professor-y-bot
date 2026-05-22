function createMemeLookup(data, label) {
  const entries = Object.entries(data); // [[caption, url], ...]

  const captionList = entries.map(([text], i) => `${i + 1}. ${text}`).join("\n");

  const prompt =
    `You are selecting the best matching ${label} for a description.\n` +
    `Return ONLY a single integer: the number of the best matching caption (1–${entries.length}), or 0 if nothing fits well.\n` +
    `No explanation. No other text. Just the number.\n\nCaptions:\n${captionList}`;

  async function findBestMatch(description, backend) {
    const reply = await backend.complete([
      { role: "user", content: `${prompt}\n\nDescription: ${description}` },
    ]);
    const num = parseInt(reply.trim(), 10);
    if (!num || num < 1 || num > entries.length) return null;
    const [caption, url] = entries[num - 1];
    return { caption, url };
  }

  return { findBestMatch };
}

module.exports = { createMemeLookup };
