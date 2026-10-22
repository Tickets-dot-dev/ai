// Tool logic for the Tickets.dev MCP server, kept apart from the MCP wiring so
// it can be tested with a fake fetch.

export const API_URL = "https://api.tickets.dev/v1";
export const NO_KEY_MESSAGE =
  "No Tickets.dev API key is set. Ask the user to get one at https://tickets.dev/pricing, " +
  "set it as TICKETS_DEV_KEY in the environment their agent starts from, and restart the agent. " +
  "Never ask them to paste the key into the chat.";

export class ToolError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The key from the environment, or "" when none is really set. Plugin hosts
 * can pass an empty string or an unexpanded `${...}` placeholder. */
export function keyFromEnv(value = process.env.TICKETS_DEV_KEY) {
  const key = (value ?? "").trim();
  return !key || key.includes("${") ? "" : key;
}

/**
 * A client with a capture budget. Every billable call (a capture) spends one
 * from `maxCaptures`; past it, tools refuse instead of spending. Without a key
 * every tool explains how to add one and makes no request.
 */

export function createClient({
  apiKey = keyFromEnv(),
  maxCaptures = Number(process.env.TICKETS_DEV_MAX_CAPTURES || 25),
  fetchImpl = globalThis.fetch,
  retryWaitMs = 10_000,
} = {}) {
  let capturesUsed = 0;

  async function get(path, params = {}) {
    if (!apiKey) throw new ToolError(NO_KEY_MESSAGE);
    const url = new URL(API_URL + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(url, {
        headers: { "x-api-key": apiKey, "user-agent": "tickets-dev-mcp/0.1.0" },
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) return response.json();
      let error;
      try {
        error = (await response.json()).error;
      } catch {
        error = undefined;
      }
      error ??= { code: `HTTP ${response.status}`, retryable: [429, 502, 503, 504].includes(response.status) };
      if (!error.retryable || attempt >= 2) {
        throw new ToolError(`${error.code}${error.message ? `: ${error.message}` : ""}`);
      }
      const retryAfter = response.headers.get("retry-after");
      await sleep(retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : retryWaitMs);
    }
  }

  function spend(n) {
    if (capturesUsed + n > maxCaptures) {
      throw new ToolError(
        `Capture budget reached: ${capturesUsed} of ${maxCaptures} used this session. ` +
          "Raise TICKETS_DEV_MAX_CAPTURES to allow more (each live capture is billed).",
      );
    }
    capturesUsed += n;
  }

  return {
    get capturesUsed() {
      return capturesUsed;
    },
    maxCaptures,
    events: (params) => get("/events", params),
    sources: async () => (await get("/capture/sources")).sources,
    async capture(url, { includeVenueMaps = false } = {}) {
      if (!apiKey) throw new ToolError(NO_KEY_MESSAGE);
      spend(1);
      return get("/capture", { url, includeVenueMaps: includeVenueMaps ? "true" : undefined });
    },
  };
}

// --- formatting -----------------------------------------------------------

const money = (value, currency) =>
  typeof value === "number" && value > 0 ? `${value.toFixed(2)} ${currency}` : "no all-in price";

function sellable(listing) {
  const list = String(listing.sellableQuantities || "")
    .split(",")
    .map((q) => Number(q.trim()))
    .filter((q) => Number.isInteger(q) && q > 0);
  return list.length ? list : [listing.quantity];
}

function footer(client) {
  return `\n\nCaptures used this session: ${client.capturesUsed} of ${client.maxCaptures}.`;
}

// Whole-page totals from the capture, before any filter: what a time series of
// availability is built from.
function statsLine({ stats, currency }) {
  if (!stats) return "";
  return `\nAvailable: ${stats.ticketCount} tickets in ${stats.listingCount} listings, ` +
    `get-in ${money(stats.getInPrice, currency)}, median ${money(stats.medianPrice, currency)}`;
}

function listingLine(listing, currency) {
  const seats = listing.seats ? ` seats ${listing.seats}` : "";
  return `- ${listing.section} row ${listing.row}${seats}: ${money(listing.totalPrice, currency)} each all-in` +
    `${listing.fee > 0 ? ` (${listing.ticketPrice.toFixed(2)} + ${listing.fee.toFixed(2)} fee)` : ""}, ` +
    `sells as ${sellable(listing).join(",")}`;
}

// --- tools ------------------------------------------------------------------

export async function findEvents(client, { query, from, to }) {
  const page = await client.events({ query, from, to, pageSize: 10 });
  if (!page.events?.length) return `No upcoming events match "${query}".`;
  const lines = page.events.map((event) => {
    const markets = event.sources.map((s) => `  - ${s.marketplace}: ${s.url}`).join("\n");
    return `${event.name} | ${event.venue?.name ?? ""}${event.venue?.city ? `, ${event.venue.city}` : ""} | ${event.eventDateLocal}\n${markets}`;
  });
  return `${page.total} event(s) match. Each URL can be passed to get_listings.\n\n${lines.join("\n\n")}`;
}

export async function getListings(client, { url, quantity, max_price, top = 20 }) {
  const snapshot = await client.capture(url);
  let listings = snapshot.listings.filter((l) => !quantity || sellable(l).includes(quantity));
  if (max_price) listings = listings.filter((l) => l.totalPrice > 0 && l.totalPrice <= max_price);
  listings.sort((a, b) => (a.totalPrice || Infinity) - (b.totalPrice || Infinity));
  const head = `${snapshot.eventName} | ${snapshot.venueName} | ${snapshot.eventDateLocal}\n` +
    `${snapshot.source}, captured ${snapshot.capturedAt}: ${snapshot.listings.length} listings, ` +
    `${listings.length} match${statsLine(snapshot)}${snapshot.note ? `\nNote: ${snapshot.note.slice(0, 200)}` : ""}`;
  const body = listings.slice(0, top).map((l) => listingLine(l, snapshot.currency)).join("\n");
  return `${head}\n\n${body || "No listings match."}${footer(client)}`;
}

export async function comparePrices(client, { event, quantity = 2, top = 10, max_marketplaces = 7 }) {
  const page = await client.events({ query: event, pageSize: 1 });
  const found = page.events?.[0];
  if (!found) return `No upcoming event matches "${event}".`;
  const sources = found.sources.slice(0, max_marketplaces);
  const results = [];
  for (const source of sources) {
    try {
      results.push({ source, snapshot: await client.capture(source.url) });
    } catch (error) {
      results.push({ source, error: error.message });
      if (error.message.startsWith("Capture budget reached")) break;
    }
  }
  const rows = [];
  const status = results.map(({ source, snapshot, error }) => {
    if (error) return `- ${source.marketplace}: unavailable (${error})`;
    const fits = snapshot.listings.filter((l) => sellable(l).includes(quantity) && l.totalPrice > 0);
    for (const l of fits) rows.push({ market: source.marketplace, currency: snapshot.currency, l });
    return `- ${source.marketplace}: ${fits.length} listings can sell ${quantity}, captured ${snapshot.capturedAt}`;
  });
  rows.sort((a, b) => a.l.totalPrice - b.l.totalPrice);
  const best = rows.slice(0, top).map(
    ({ market, currency, l }) =>
      `- ${market}: ${l.section} row ${l.row}, ${money(l.totalPrice, currency)} each, ${money(l.totalPrice * quantity, currency)} for ${quantity}`,
  );
  return `${found.name} | ${found.venue?.name ?? ""} | ${found.eventDateLocal}\n\n${status.join("\n")}\n\n` +
    `Cheapest ${quantity} tickets, all-in (fees included, before tax):\n${best.join("\n") || "None match."}` +
    `\n\nCompare one currency at a time; prices are per ticket.${footer(client)}`;
}

export async function getSeatMap(client, { url }) {
  const snapshot = await client.capture(url, { includeVenueMaps: true });
  const cheapest = new Map();
  for (const l of snapshot.listings) {
    if (!(l.totalPrice > 0)) continue;
    const prev = cheapest.get(l.section);
    if (!prev || l.totalPrice < prev) cheapest.set(l.section, l.totalPrice);
  }
  const sections = [...cheapest.entries()].sort((a, b) => a[1] - b[1])
    .map(([section, price]) => `- ${section}: from ${money(price, snapshot.currency)}`);
  return `${snapshot.eventName} on ${snapshot.source}, captured ${snapshot.capturedAt}\n` +
    `Section map (SVG): ${snapshot.sectionLevelUrl || "not available for this event"}\n` +
    `Seat map (SVG): ${snapshot.seatLevelUrl || "not available"}\n` +
    `Venue map capacity: ${snapshot.venueLayout?.capacity ?? "not given for this marketplace's map"}\n` +
    `Map shapes carry the listings' section names (data-section or data-section-name), so sections can be coloured by price.\n\n` +
    `Cheapest all-in price per section:\n${sections.join("\n") || "No priced listings."}${footer(client)}`;
}

export async function listMarketplaces(client) {
  const sources = await client.sources();
  return sources.map((s) => `- ${s.source}: ${s.hosts.join(", ")}${s.searchable ? " (in find_events)" : ""}`).join("\n");
}
