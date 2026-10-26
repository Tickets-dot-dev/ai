// Offline: the hosted HTTP server with the SDK's MCP client and a fake fetch.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer } from "../src/http.js";

const events = { total: 1, events: [{ name: "Eagles", venue: { name: "Sphere", city: "Las Vegas" }, eventDateLocal: "2026-12-11",
  sources: [{ marketplace: "stubhub", url: "https://www.stubhub.com/e/1" }] }] };
const snap = { eventName: "Eagles", venueName: "Sphere", eventDateLocal: "2026-12-11", source: "stubhub", capturedAt: "t", currency: "USD",
  note: "", listings: [{ section: "110", row: "1", seats: "", quantity: 2, sellableQuantities: "2", ticketPrice: 400, fee: 0, totalPrice: 400 }] };

const seen = [];
const fetchImpl = async (url, init) => {
  seen.push({ path: new URL(url).pathname, key: init.headers["x-api-key"], agent: init.headers["user-agent"] });
  return new Response(JSON.stringify(new URL(url).pathname.endsWith("/events") ? events : snap), { status: 200 });
};
let server, base;
before(async () => {
  server = await startServer({ port: 0, fetchImpl });
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function connect(headers = {}, url = base) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers } }));
  return client;
}
const text = (r) => r.content.map((c) => c.text).join("\n");
const post = (url, headers, message) => fetch(`${url}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }),
});

test("lists the five tools without a key", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["compare_prices", "find_events", "get_listings", "get_seat_map", "list_marketplaces"]);
  await client.close();
});

test("without a key, tools explain the header and make no request", async () => {
  const before = seen.length;
  const client = await connect();
  const result = await client.callTool({ name: "find_events", arguments: { query: "eagles" } });
  assert.ok(result.isError);
  assert.match(text(result), /Authorization: Bearer/);
  assert.equal(seen.length, before);
  await client.close();
});

test("the caller's bearer key reaches the API, and captures are counted per call", async () => {
  const client = await connect({ authorization: "Bearer tk_a" });
  assert.match(text(await client.callTool({ name: "find_events", arguments: { query: "eagles" } })), /stubhub/);
  assert.deepEqual(seen.at(-1), { path: "/v1/events", key: "tk_a", agent: "tickets-dev-mcp-hosted/0.1.0" });
  for (let i = 0; i < 2; i++) {
    const listings = await client.callTool({ name: "get_listings", arguments: { url: "https://www.stubhub.com/e/1" } });
    assert.match(text(listings), /Captures used in this call: 1 of 15/);
  }
  await client.close();
});

test("no session: another instance answers a client that started elsewhere, as after a redeploy", async () => {
  const other = await startServer({ port: 0, fetchImpl });
  try {
    const client = await connect({ authorization: "Bearer tk_a" });
    const response = await post(`http://localhost:${other.address().port}`, { authorization: "Bearer tk_a" },
      { method: "tools/call", params: { name: "find_events", arguments: { query: "eagles" } } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /stubhub/);
    await client.close();
  } finally {
    other.close();
  }
});

test("GET and DELETE are 405; health and CORS preflight work", async () => {
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: "DELETE" })).status, 405);
  assert.equal(await (await fetch(`${base}/health`)).text(), "ok");
  const preflight = await fetch(`${base}/mcp`, { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /authorization/);
});
