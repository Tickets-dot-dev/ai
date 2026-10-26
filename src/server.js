// The Tickets.dev MCP server's tools, shared by the stdio entry (index.js) and
// the hosted HTTP entry (http.js).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { comparePrices, findEvents, getListings, getSeatMap, listMarketplaces } from "./tools.js";

const billing = "Each marketplace captured is one billed Tickets.dev capture.";

/** An MCP server whose tools all use `client` (from createClient). */
export function createServer(client) {
  const server = new McpServer({ name: "tickets-dev", version: "0.1.0" });

  const wrap = (fn) => async (args) => {
    try {
      return { content: [{ type: "text", text: await fn(client, args) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  };

  server.registerTool(
    "find_events",
    {
      title: "Find events",
      description:
        "Find upcoming events by name, performer, venue or any marketplace event URL, with the same event's URL on every marketplace that lists it (Ticketmaster, StubHub, SeatGeek, Vivid Seats, TickPick, Gametime, Viagogo and more). Never billed.",
      inputSchema: {
        query: z.string().describe('e.g. "eagles sphere" or a stubhub.com event URL'),
        from: z.string().optional().describe("Earliest date, ISO 8601"),
        to: z.string().optional().describe("Latest date, ISO 8601"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(findEvents),
  );

  server.registerTool(
    "get_listings",
    {
      title: "Get live listings",
      description: `Every listing on one marketplace event page right now: section, row, seats, quantities it can sell, face price, fee and all-in price per ticket, cheapest first. ${billing} A listing that disappears later may have sold, been delisted or been repriced; it is not proof of a sale.`,
      inputSchema: {
        url: z.string().url().describe("One marketplace event page URL (from find_events or the user)"),
        quantity: z.number().int().positive().optional().describe("Only listings that can sell exactly this many"),
        max_price: z.number().positive().optional().describe("Only listings at or below this all-in price per ticket"),
        top: z.number().int().positive().max(100).optional().describe("How many to return, default 20"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(getListings),
  );

  server.registerTool(
    "compare_prices",
    {
      title: "Compare prices across marketplaces",
      description: `Find one event, capture it on each marketplace, and rank the cheapest tickets for a quantity by all-in price (fees included). ${billing} Captures up to max_marketplaces (default 7).`,
      inputSchema: {
        event: z.string().describe("Event name or any marketplace event URL"),
        quantity: z.number().int().positive().optional().describe("Tickets wanted, default 2"),
        top: z.number().int().positive().max(50).optional().describe("Rows to return, default 10"),
        max_marketplaces: z.number().int().positive().max(15).optional().describe("Most marketplaces to capture, default 7"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(comparePrices),
  );

  server.registerTool(
    "get_seat_map",
    {
      title: "Get seat map",
      description: `The marketplace's own section and seat maps (SVG URLs) for an event, the cheapest all-in price per section, and the venue map's seat capacity where the marketplace gives one. ${billing}`,
      inputSchema: { url: z.string().url().describe("One marketplace event page URL") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(getSeatMap),
  );

  server.registerTool(
    "list_marketplaces",
    {
      title: "List marketplaces",
      description: "The marketplaces Tickets.dev can capture and the hosts that route to each. Never billed.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(listMarketplaces),
  );

  return server;
}
