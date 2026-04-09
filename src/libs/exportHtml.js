const { marked } = require("marked");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Extract the @username prefix that index.js prepends to every user message.
function parseUserMessage(content) {
  const text =
    typeof content === "string"
      ? content
      : content.filter?.((b) => b.type === "text").map((b) => b.text).join(" ") || "[image]";
  const match = text.match(/^@(\S+): ([\s\S]*)$/);
  return match
    ? { sender: `@${match[1]}`, body: match[2] }
    : { sender: "User", body: text };
}

function renderBubble(role, content) {
  if (role === "assistant") {
    return marked.parse(typeof content === "string" ? content : "");
  }
  const { body } = parseUserMessage(content);
  return `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`;
}

function exportHtml(history, botName) {
  const exportedAt = new Date().toLocaleString();

  const messagesHtml = history
    .map((msg) => {
      const isUser = msg.role === "user";
      const sender = isUser
        ? parseUserMessage(msg.content).sender
        : botName || "Assistant";
      const bubble = renderBubble(msg.role, msg.content);
      return `    <div class="message ${isUser ? "user" : "assistant"}">
      <div class="sender">${escapeHtml(sender)}</div>
      <div class="bubble">${bubble}</div>
    </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conversation Export</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #e5ddd5;
      min-height: 100vh;
      padding: 16px;
    }
    .container { max-width: 820px; margin: 0 auto; }
    .header {
      text-align: center;
      color: #667781;
      font-size: 12px;
      background: #ffffffcc;
      padding: 5px 12px;
      border-radius: 8px;
      display: inline-block;
      margin: 0 auto 12px;
      width: 100%;
    }
    .messages { display: flex; flex-direction: column; gap: 4px; }
    .message { display: flex; flex-direction: column; max-width: 72%; margin-bottom: 2px; }
    .message.user { align-self: flex-end; align-items: flex-end; }
    .message.assistant { align-self: flex-start; align-items: flex-start; }
    .sender { font-size: 12px; color: #667781; margin-bottom: 3px; padding: 0 6px; }
    .bubble {
      padding: 7px 12px 8px;
      border-radius: 7.5px;
      font-size: 14px;
      line-height: 1.55;
      word-wrap: break-word;
    }
    .user .bubble { background: #d9fdd3; border-radius: 7.5px 7.5px 0 7.5px; }
    .assistant .bubble {
      background: #fff;
      border-radius: 7.5px 7.5px 7.5px 0;
      box-shadow: 0 1px 1px rgba(0,0,0,.08);
    }
    .bubble p { margin-bottom: 6px; }
    .bubble p:last-child { margin-bottom: 0; }
    .bubble strong { font-weight: 600; }
    .bubble code {
      background: #f0f2f5;
      padding: 1px 5px;
      border-radius: 4px;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 13px;
    }
    .bubble pre {
      background: #f0f2f5;
      padding: 10px 14px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 6px 0;
    }
    .bubble pre code { background: none; padding: 0; font-size: 13px; }
    .bubble ul, .bubble ol { padding-left: 20px; margin: 4px 0; }
    .bubble li { margin-bottom: 2px; }
    .bubble blockquote {
      border-left: 3px solid #ccd1d5;
      padding-left: 10px;
      color: #667781;
      margin: 6px 0;
    }
    .bubble h1, .bubble h2, .bubble h3 { font-weight: 600; margin: 8px 0 4px; }
    .bubble a { color: #0070cc; text-decoration: none; }
    .bubble a:hover { text-decoration: underline; }
    .bubble table { border-collapse: collapse; width: 100%; margin: 6px 0; }
    .bubble th, .bubble td { border: 1px solid #ccd1d5; padding: 6px 10px; text-align: left; }
    .bubble th { background: #f0f2f5; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">Exported on ${escapeHtml(exportedAt)}</div>
    <div class="messages">
${messagesHtml}
    </div>
  </div>
</body>
</html>`;
}

module.exports = exportHtml;
