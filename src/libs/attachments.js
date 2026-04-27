/**
 * Returns the best image attachment from a Telegram message, or null if none.
 * For compressed photos, Telegram sends an array of sizes — we take the last
 * (largest) one. Uncompressed image documents are also supported.
 * For stickers (static, animated, or video), the thumbnail is used.
 *
 * @param {object|null|undefined} msg - A Telegram message object
 * @returns {object|null} A Telegram PhotoSize/Document object with file_id, or null
 */
function getLastImage(msg) {
  if (!msg) return null;
  if (msg.photo) return msg.photo[msg.photo.length - 1];
  if (msg.document?.mime_type?.startsWith("image/")) return msg.document;
  if (msg.sticker?.thumbnail) return msg.sticker.thumbnail;
  return null;
}

function sniffImageMediaType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "image/png";
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)
    return "image/gif";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  return "image/jpeg";
}

/**
 * Converts a Telegram attachment (PhotoSize / Document / sticker thumbnail) into
 * a neutral LLM image block by streaming the file via node-telegram-bot-api.
 *
 * @param {import("node-telegram-bot-api")} bot - Telegram bot instance
 * @param {object} attachment - Telegram attachment with `file_id`
 * @returns {{ type: "image", mediaType: string, data: string }}
 */
async function toImageBlock(bot, attachment) {
  const stream = bot.getFileStream(attachment.file_id);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  return {
    type: "image",
    mediaType: sniffImageMediaType(buffer),
    data: buffer.toString("base64"),
  };
}

module.exports = { getLastImage, toImageBlock };
