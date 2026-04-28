const { fetch } = require("undici");
const PLACES_BASE = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";
const DEFAULT_LIMIT = 5;

const definition = {
  name: "search_map",
  description:
    "Search for places, points of interest, or addresses using Google Maps. " +
    "Use for place recommendations, finding locations, geocoding an address to coordinates, " +
    "or reverse geocoding coordinates to an address.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Free-text place or address to search for (e.g. 'ramen near Shibuya', 'coffee shops in Taipei', 'Eiffel Tower'). " +
          "Required for text search. Omit when using lat+lon for reverse geocoding.",
      },
      lat: {
        type: "number",
        description: "Latitude for reverse geocoding. Must be provided together with lon.",
      },
      lon: {
        type: "number",
        description: "Longitude for reverse geocoding. Must be provided together with lat.",
      },
      limit: {
        type: "integer",
        description: "Maximum number of results to return (1–20). Defaults to 5.",
        minimum: 1,
        maximum: 20,
      },
    },
    required: [],
  },
};

/**
 * Format a single Google Places result into a readable text block.
 * @param {object} r - Places API result object
 * @param {number|null} index - 1-based index for list display, null for single result
 * @returns {string}
 */
function formatPlaceResult(r, index) {
  const prefix = index != null ? `${index}. ` : "";
  const name = r.name || "Unknown";
  const address = r.formatted_address || "";
  const lat = r.geometry?.location?.lat?.toFixed(4) ?? "";
  const lng = r.geometry?.location?.lng?.toFixed(4) ?? "";
  const placeId = r.place_id;
  const mapsUrl = placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : null;

  const types = (r.types || [])
    .filter((t) => t !== "point_of_interest" && t !== "establishment")
    .map((t) => t.replace(/_/g, " "))
    .slice(0, 3)
    .join(", ");

  const lines = [`${prefix}${name}${types ? ` (${types})` : ""}`];
  if (address) lines.push(`   Address: ${address}`);
  if (lat && lng) lines.push(`   Coordinates: ${lat}, ${lng}`);
  if (mapsUrl) lines.push(`   Google Maps: ${mapsUrl}`);
  if (r.rating != null) {
    const price = r.price_level != null ? " · " + "$".repeat(r.price_level) : "";
    lines.push(`   Rating: ${r.rating}/5${price}`);
  }
  if (r.opening_hours?.open_now != null) {
    lines.push(`   Open now: ${r.opening_hours.open_now ? "Yes" : "No"}`);
  }

  return lines.join("\n");
}

/**
 * Format a single Google Geocoding result into a readable text block.
 * @param {object} r - Geocoding API result object
 * @returns {string}
 */
function formatGeocodeResult(r) {
  const address = r.formatted_address || "";
  const lat = r.geometry?.location?.lat?.toFixed(4) ?? "";
  const lng = r.geometry?.location?.lng?.toFixed(4) ?? "";
  const placeId = r.place_id;
  const mapsUrl = placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : null;

  const lines = [];
  if (address) lines.push(`Address: ${address}`);
  if (lat && lng) lines.push(`Coordinates: ${lat}, ${lng}`);
  if (mapsUrl) lines.push(`Google Maps: ${mapsUrl}`);

  return lines.join("\n");
}

/**
 * Execute the search_map tool.
 * @param {{ query?: string, lat?: number, lon?: number, limit?: number }} args
 * @returns {Promise<string>}
 */
async function execute({ query, lat, lon, limit }) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return "Error: GOOGLE_MAPS_API_KEY is not configured.";
  }

  const isReverse = lat != null && lon != null;

  if (!isReverse && !query) {
    return "Error: provide either a query string or lat+lon coordinates.";
  }

  let url;
  if (isReverse) {
    const params = new URLSearchParams({ latlng: `${lat},${lon}`, key: apiKey });
    url = `${GEOCODE_BASE}?${params}`;
  } else {
    const params = new URLSearchParams({ query, key: apiKey });
    url = `${PLACES_BASE}?${params}`;
  }

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return `Error searching map: ${err.message}`;
  }

  if (!res.ok) {
    return `Error searching map: HTTP ${res.status}`;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return "Error searching map: unexpected response format.";
  }

  if (data.status === "REQUEST_DENIED") {
    return `Error searching map: ${data.error_message || "request denied (check API key and enabled APIs)"}`;
  }

  if (isReverse) {
    if (data.status === "ZERO_RESULTS" || !data.results?.length) {
      return `No location found for coordinates ${lat}, ${lon}.`;
    }
    return formatGeocodeResult(data.results[0]);
  }

  if (data.status === "ZERO_RESULTS" || !data.results?.length) {
    return `No results found for: ${query}`;
  }

  const cap = Math.min(20, Math.max(1, limit ?? DEFAULT_LIMIT));
  return data.results
    .slice(0, cap)
    .map((r, i) => formatPlaceResult(r, i + 1))
    .join("\n\n");
}

module.exports = { definition, execute, formatPlaceResult, PLACES_BASE };
