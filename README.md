![tickets.dev AI: ask for the cheapest 2 seats for the Eagles at Sphere, get the same seats priced on TickPick, SeatGeek, Vivid Seats and Gametime](assets/banner.gif)

# Tickets.dev AI

This repo is the home for using Tickets.dev with AI agents. Tickets.dev returns live ticket listings, all-in prices and seat maps from Ticketmaster, StubHub, SeatGeek, Vivid Seats, TickPick, Gametime, Viagogo and more, in one schema.

Tickets.dev is a standard HTTP API, so any agent that can make web requests can use it. This repo adds an agent skill, plugins for popular agent tools, and an MCP server.

## What you can ask

> I have 2 seats in section 110, row 36 for the Eagles at Sphere. What are the same and nearby seats listed for on each marketplace?

> Show the seat map for this StubHub event with the cheapest all-in price in each section.

> How many tickets are listed for each Sphere show next month, and what's the get-in price?

> Write a script that saves the listed tickets and get-in price for these events every morning.

## Use the API with any agent

Give your agent the [OpenAPI spec](https://tickets.dev/openapi.json), the [agent docs](https://tickets.dev/llms.txt) and your API key. Get a key at [tickets.dev](https://tickets.dev/pricing) and send it in the `x-api-key` header.

Most tasks take two calls. Find the event, then capture one marketplace page:

```bash
curl "https://api.tickets.dev/v1/events?query=eagles%20sphere" \
  -H "x-api-key: $TICKETS_DEV_KEY"

curl -G "https://api.tickets.dev/v1/capture" \
  --data-urlencode "url=https://www.ticketmaster.com/eagles-live-at-sphere-las-vegas-nevada-12-11-2026/event/17006483D6FAFC60" \
  -H "x-api-key: $TICKETS_DEV_KEY"
```

## Agent skill

The [`tickets-dev` skill](skills/tickets-dev/SKILL.md) covers the details of ticket data that agents tend to get wrong, such as all-in prices, sellable quantities, and why a listing that disappears isn't proof of a sale. It's plain Markdown, so you can add it to any agent's instructions.

## Plugins

If you use one of these agent tools, we recommend installing the Tickets.dev plugin. It includes the skill and tools your agent can call directly.

### Claude Code

Run these commands in Claude Code:

```bash
/plugin marketplace add Tickets-dot-dev/ai
/plugin install tickets-dev@tickets-dev
```

### Codex

Run this command:

```bash
codex plugin marketplace add Tickets-dot-dev/ai
```

Then restart Codex and install Tickets.dev from the Plugins directory.

### Cursor

Install the plugin from [cursor.directory](https://cursor.directory), or use the [MCP server](#mcp-server).

### Gemini CLI

Run this command:

```bash
gemini extensions install https://github.com/Tickets-dot-dev/ai
```

### Grok Build

The plugin is coming to the Grok Build marketplace. Until then, use the [MCP server](#mcp-server).

## MCP server

Any MCP client can run the tools directly. Add this to your client's MCP configuration, for example `.cursor/mcp.json` or Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tickets-dev": {
      "command": "npx",
      "args": ["-y", "tickets-dev-mcp"],
      "env": { "TICKETS_DEV_KEY": "tk_live_..." }
    }
  }
}
```

### Hosted

Clients that connect to remote MCP servers can skip the install and use `https://mcp.tickets.dev/mcp` (Streamable HTTP), sending the key as a header:

```json
{
  "mcpServers": {
    "tickets-dev": {
      "url": "https://mcp.tickets.dev/mcp",
      "headers": { "Authorization": "Bearer tk_live_..." }
    }
  }
}
```

The key is sent with each request and is never stored. One tool call uses at most 15 captures.

| Tool | What it does |
|---|---|
| `find_events` | Finds upcoming events and their URL on every marketplace. Free. |
| `get_listings` | Returns every listing on one event page, with all-in prices. |
| `compare_prices` | Ranks one event's listings across marketplaces by all-in price. |
| `get_seat_map` | Returns the section and seat maps, the cheapest price per section and, where the map gives it, venue capacity. |
| `list_marketplaces` | Lists supported marketplaces. Free. |

The tools only read data. They can't buy, hold or list tickets.

## API key

The plugins and the MCP server read your key from the `TICKETS_DEV_KEY` environment variable:

```bash
export TICKETS_DEV_KEY=tk_live_...
```

Restart your agent after setting it. Don't paste your key into a chat. If the key is missing, the agent tells you how to add it.

Each capture of one event on one marketplace is billed. To limit spending, set `TICKETS_DEV_MAX_CAPTURES` (default `25` per session). See [pricing](https://tickets.dev/pricing).

## More from Tickets.dev

* [API documentation](https://tickets.dev/docs)
* Examples: [price comparison app](https://github.com/Tickets-dot-dev/ticket-price-comparison-app), [price alerts](https://github.com/Tickets-dot-dev/ticket-price-alerts), [price tracker](https://github.com/Tickets-dot-dev/ticket-price-tracker)

## Development

```bash
npm install
node --test                                  # offline tests
TICKETS_DEV_E2E_KEY=<your key> node --test   # end-to-end tests (uses a few captures)
```

## License

[MIT](LICENSE). Not affiliated with any ticket marketplace.
