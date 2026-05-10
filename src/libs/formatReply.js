const { marked } = require("marked");
const { table } = require("table");

function renderTableBlocks(text) {
  return text.replace(/```table\n([\s\S]*?)```/g, (match, csv) => {
    try {
      const rows = csv
        .trim()
        .split("\n")
        .filter((line) => line.trim())
        .map((row) => row.split(",").map((cell) => cell.trim()));
      return `<pre>${table(rows)}</pre>`;
    } catch {
      return match;
    }
  });
}

function formatReply(text) {
  let html = marked(renderTableBlocks(text), { breaks: true });

  return (
    html
      // Headings → bold (Telegram doesn't support heading tags)
      .replace(/<h[1-6]>([\s\S]*?)<\/h[1-6]>/g, "<b>$1</b>\n")
      // Normalize to Telegram-supported inline tags
      .replace(/<strong>/g, "<b>")
      .replace(/<\/strong>/g, "</b>")
      .replace(/<em>/g, "<i>")
      .replace(/<\/em>/g, "</i>")
      .replace(/<del>/g, "<s>")
      .replace(/<\/del>/g, "</s>")
      // Unwrap <p> tags, preserve content + spacing
      .replace(/<p>([\s\S]*?)<\/p>/g, "$1\n\n")
      // <br> → newline
      .replace(/<br\s*\/?>/g, "\n")
      // List items → bullet points (trim content to strip \n\n left by <p> replacement)
      .replace(/<li>([\s\S]*?)<\/li>/g, (_, content) => `• ${content.trim()}\n`)
      // Remove list wrapper tags
      .replace(/<\/?[uo]l>/g, "")
      // Collapse extra blank lines between consecutive bullet points
      .replace(/\n\n(• )/g, "\n$1")
      // <hr> → just a newline
      .replace(/<hr\s*\/?>/g, "\n")
      // Strip any remaining unsupported tags, preserving: b, i, u, s, code, pre, a, blockquote
      .replace(/<(?!\/?(?:b|i|u|s|code|pre|a|blockquote)\b)[^>]*>/g, "")
      // Telegram does not support any nested tags inside <a> — strip inner tags from link content
      .replace(
        /<a(\s[^>]*)?>([\s\S]*?)<\/a>/g,
        (_, attrs, content) =>
          `<a${attrs ?? ""}>${content.replace(/<[^>]+>/g, "")}</a>`,
      )
      // Collapse excessive newlines (marked adds \n after blocks, replacements add more)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

module.exports = formatReply;
