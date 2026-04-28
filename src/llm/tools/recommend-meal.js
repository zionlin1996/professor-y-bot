const { fetch } = require("undici");
const { formatPlaceResult, PLACES_BASE } = require("./search-map");

const definition = {
  name: "recommend_meal",
  description:
    "Search for restaurants or eateries matching a cuisine and location, then return 3 randomly " +
    "selected recommendations. Use this for meal recommendations when the user wants to discover " +
    "what to eat near a specific location.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Cuisine type and location to search for (e.g. 'ramen near Taipei 101', " +
          "'brunch near Da\\'an District'). Should combine a food type with a nearby location.",
      },
    },
    required: ["query"],
  },
};

/**
 * Fisher-Yates in-place shuffle.
 * @param {Array} arr
 * @returns {Array} the same array, shuffled
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Execute the recommend_meal tool.
 * @param {{ query: string }} args
 * @returns {Promise<string>}
 */
async function execute({ query }) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return "Error: GOOGLE_MAPS_API_KEY is not configured.";
  }

  const params = new URLSearchParams({ query, key: apiKey });
  const url = `${PLACES_BASE}?${params}`;

  console.log(`[recommend-meal] query="${query}"`);

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(`[recommend-meal] fetch error: ${err.message}`);
    return `Error fetching recommendations: ${err.message}`;
  }

  if (!res.ok) {
    console.error(`[recommend-meal] HTTP error: ${res.status} for query="${query}"`);
    return `Error fetching recommendations: HTTP ${res.status}`;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error(`[recommend-meal] failed to parse JSON response for query="${query}"`);
    return "Error fetching recommendations: unexpected response format.";
  }

  console.log(`[recommend-meal] API status="${data.status}" results=${data.results?.length ?? 0} query="${query}"`);

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    const msg = data.error_message || data.status;
    console.error(`[recommend-meal] API error: ${msg} query="${query}"`);
    return `Error fetching recommendations: ${msg}`;
  }

  if (data.status === "ZERO_RESULTS" || !data.results?.length) {
    return `No results found for: ${query}`;
  }

  const results = data.results.slice(0, 20);
  shuffle(results);
  const picks = results.slice(0, 3);

  console.log(`[recommend-meal] returning ${picks.length} picks for query="${query}"`);
  return `Here are 3 recommendations:\n\n${picks.map((r, i) => formatPlaceResult(r, i + 1)).join("\n\n")}`;
}

module.exports = { definition, execute, shuffle };
