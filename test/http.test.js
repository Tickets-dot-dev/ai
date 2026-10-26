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
let server, base;
before(async () => {
  const fetchImpl = async (url, init) => {
    seen.push({ path: new URL(url).pathname, key: init.headers["x-api-key"], agent: init.headers["user-agent"] });
    return new Response(JSON.stringify(new URL(url).pathname.endsWith("/events") ? events : snap), { status: 200 });
  };
  server = await startServer({ port: 0, fetchImpl });
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function connect(headers = {}) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return { client, transport };
}
const text = (r) => r.content.map((c) => c.text).join("\n");

test("lists the five tools without a key", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["compare_prices", "find_events", "get_listings", "get_seat_map", "list_marketplaces"]);
  await client.close();
});

test("without a key, tools explain the header and make no request", async () => {
  const before = seen.length;
  const { client } = await connect();
  const result = await client.callTool({ name: "find_events", arguments: { query: "eagles" } });
  assert.ok(result.isError);
  assert.match(text(result), /Authorization: Bearer/);
  assert.equal(seen.length, before);
  await client.close();
});

test("the caller's bearer key reaches the API", async () => {
  const { client } = await connect({ authorization: "Bearer tk_a" });
  assert.match(text(await client.callTool({ name: "find_events", arguments: { query: "eagles" } })), /stubhub/);
  assert.deepEqual(seen.at(-1), { path: "/v1/events", key: "tk_a", agent: "tickets-dev-mcp-hosted/0.1.0" });
  await client.close();
});

test("x-max-captures sets the session's budget", async () => {
  const { client } = await connect({ "x-api-key": "tk_a", "x-max-captures": "1" });
  const first = await client.callTool({ name: "get_listings", arguments: { url: "https://www.stubhub.com/e/1" } });
  assert.match(text(first), /Captures used this session: 1 of 1/);
  const second = await client.callTool({ name: "get_listings", arguments: { url: "https://www.stubhub.com/e/1" } });
  assert.ok(second.isError);
  assert.match(text(second), /x-max-captures/);
  await client.close();
});

test("a session refuses a different key", async () => {
  const { client, transport } = await connect({ authorization: "Bearer tk_a" });
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer tk_b", "mcp-session-id": transport.sessionId, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
  });
  assert.equal(response.status, 403);
  await client.close();
});

test("an unknown session is 404 and a non-initialize first request is 400", async () => {
  const post = (headers) => fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal((await post({ "mcp-session-id": "nope" })).status, 404);
  assert.equal((await post({})).status, 400);
});

test("health and CORS preflight", async () => {
  assert.equal(await (await fetch(`${base}/health`)).text(), "ok");
  const preflight = await fetch(`${base}/mcp`, { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /authorization/);
});
