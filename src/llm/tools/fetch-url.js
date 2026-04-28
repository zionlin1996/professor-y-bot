const { fetch } = require("undici");
const MAX_CONTENT_LENGTH = 15000;
const JINA_BASE = "https://r.jina.ai";

const definition = {
  name: "fetch_url",
  description:
    "Fetch the content of a URL and return it as readable text. " +
    "Use this when the user shares a link and wants you to read, summarise, or discuss its contents.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The full URL to fetch (must start with http:// or https://)",
      },
    },
    required: ["url"],
  },
};

/**
 * Fetch a URL via Jina Reader and return its content as markdown text.
 * @param {{ url: string }} args
 * @returns {Promise<string>} - page content (truncated) or error message
 */
async function execute({ url }) {
  let res;
  try {
    res = await fetch(`${JINA_BASE}/${url}`, {
      headers: { Accept: "text/markdown" },
    });
  } catch (err) {
    return `Error fetching URL: ${err.message}`;
  }

  if (!res.ok) {
    return `Error fetching URL: HTTP ${res.status}`;
  }

  const text = await res.text();
  if (text.length <= MAX_CONTENT_LENGTH) return text;

  return text.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated]";
}

module.exports = { definition, execute };
