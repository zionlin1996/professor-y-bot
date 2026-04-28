const { fetch } = require("undici");

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

/**
 * Converts a Telegram PhotoSize/Document object into a neutral LLM image block.
 * Reads TELEGRAM_BOT_TOKEN from env; calls the Telegram API directly (no SDK).
 *
 * @param {object} file - Telegram PhotoSize or Document object with file_id
 * @returns {{ type: "image", mediaType: string, data: string }}
 */
async function toImageBlock(file) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }
  const data = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: file.file_id }),
  }).then((res) => res.json());
  const { file_path } = data.result;
  const fileResponse = await fetch(
    `https://api.telegram.org/file/bot${token}/${file_path}`,
  );
  const buffer = await fileResponse.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const ext = file_path.split(".").pop().toLowerCase();
  const mediaType =
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
    }[ext] || "image/jpeg";
  return { type: "image", mediaType, data: base64 };
}

module.exports = { getLastImage, toImageBlock };
