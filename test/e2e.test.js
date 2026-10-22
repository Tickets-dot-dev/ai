// End-to-end over stdio with the SDK's MCP client, against the real API.
// Runs only with a key, and spends a few captures:
//   TICKETS_DEV_E2E_KEY=<key> node --test
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const URL_SH = "https://www.stubhub.com/the-eagles-las-vegas-tickets-12-11-2026/event/161551904";

async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../src/index.js", import.meta.url).pathname],
    env: { PATH: process.env.PATH, TICKETS_DEV_KEY: process.env.TICKETS_DEV_E2E_KEY, ...env },
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}
const text = (r) => r.content.map((c) => c.text).join("\n");

test("lists the five tools", { skip: !process.env.TICKETS_DEV_E2E_KEY }, async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["compare_prices", "find_events", "get_listings", "get_seat_map", "list_marketplaces"]);
  await client.close();
});

test("each tool works", { skip: !process.env.TICKETS_DEV_E2E_KEY }, async () => {
  const client = await connect();
  const find = text(await client.callTool({ name: "find_events", arguments: { query: "eagles sphere" } }));
  assert.match(find, /Eagles/); assert.match(find, /stubhub/);
  const listings = text(await client.callTool({ name: "get_listings", arguments: { url: URL_SH, quantity: 2 } }));
  assert.match(listings, /all-in/);
  const compare = text(await client.callTool({ name: "compare_prices", arguments: { event: "eagles sphere", quantity: 2, top: 5 } }));
  assert.match(compare, /Cheapest 2 tickets/);
  const map = text(await client.callTool({ name: "get_seat_map", arguments: { url: URL_SH } }));
  assert.match(map, /storage\.tickets\.dev\/seatmaps/);
  const markets = text(await client.callTool({ name: "list_marketplaces", arguments: {} }));
  assert.match(markets, /ticketmaster/);
  await client.close();
});

test("the capture budget stops spending", { skip: !process.env.TICKETS_DEV_E2E_KEY }, async () => {
  const client = await connect({ TICKETS_DEV_MAX_CAPTURES: "1" });
  const first = await client.callTool({ name: "get_listings", arguments: { url: URL_SH } });
  assert.ok(!first.isError);
  const second = await client.callTool({ name: "get_listings", arguments: { url: URL_SH } });
  assert.ok(second.isError); assert.match(text(second), /Capture budget reached: 1 of 1/);
  await client.close();
});

test("without a key, tools explain how to add one", { skip: !process.env.TICKETS_DEV_E2E_KEY }, async () => {
  const client = await connect({ TICKETS_DEV_KEY: "" });
  const result = await client.callTool({ name: "find_events", arguments: { query: "eagles sphere" } });
  assert.ok(result.isError); assert.match(text(result), /tickets\.dev\/pricing/);
  await client.close();
});
