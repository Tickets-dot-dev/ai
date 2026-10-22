// Offline: retries, errors and the budget, with a fake fetch.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient, findEvents, getListings, getSeatMap, keyFromEnv, ToolError } from "../src/tools.js";

const fake = (responses) => async () => {
  const { status, body, headers = {} } = responses.shift();
  return new Response(JSON.stringify(body), { status, headers });
};
const snap = { eventName: "E", venueName: "V", eventDateLocal: "2026-12-11T20:30:00-08:00", source: "stubhub", capturedAt: "t",
  currency: "USD", note: "", listings: [{ section: "110", row: "1", seats: "", quantity: 2, sellableQuantities: "2", ticketPrice: 400, fee: 0, totalPrice: 400 }] };

test("retries a retryable 429, then succeeds", async () => {
  const client = createClient({ apiKey: "k", retryWaitMs: 0, fetchImpl: fake([
    { status: 429, body: { error: { code: "rate_limited", retryable: true } }, headers: { "retry-after": "0" } },
    { status: 200, body: snap }]) });
  assert.match(await getListings(client, { url: "https://x" }), /400\.00 USD each all-in/);
});

test("listings report the page's availability totals", async () => {
  const body = { ...snap, stats: { listingCount: 4, ticketCount: 43, getInPrice: 303.08, medianPrice: 494.64 } };
  const client = createClient({ apiKey: "k", fetchImpl: fake([{ status: 200, body }]) });
  assert.match(await getListings(client, { url: "https://x" }), /Available: 43 tickets in 4 listings, get-in 303\.08 USD, median 494\.64 USD/);
});

test("a non-retryable error is reported, not retried", async () => {
  let calls = 0;
  const client = createClient({ apiKey: "k", fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: { code: "invalid_key", message: "bad", retryable: false } }), { status: 401 }); } });
  await assert.rejects(getListings(client, { url: "https://x" }), (e) => e instanceof ToolError && /invalid_key: bad/.test(e.message));
  assert.equal(calls, 1);
});

test("no key: every tool explains how to add one, and nothing is requested", async () => {
  let calls = 0;
  const client = createClient({ apiKey: "", fetchImpl: async () => { calls++; return new Response("{}"); } });
  for (const run of [() => getListings(client, { url: "https://x" }), () => findEvents(client, { query: "eagles" })]) {
    await assert.rejects(run, (e) => e instanceof ToolError && /tickets\.dev\/pricing/.test(e.message) && /never ask them to paste/i.test(e.message));
  }
  assert.equal(calls, 0); assert.equal(client.capturesUsed, 0);
});

test("budget refuses before spending", async () => {
  let calls = 0;
  const client = createClient({ apiKey: "k", maxCaptures: 0, fetchImpl: async () => { calls++; return new Response("{}"); } });
  await assert.rejects(getListings(client, { url: "https://x" }), /Capture budget reached: 0 of 0/);
  assert.equal(calls, 0);
});

test("an empty or unexpanded key counts as no key", () => {
  for (const value of [undefined, "", "  ", "${TICKETS_DEV_KEY}", "${env:TICKETS_DEV_KEY}"]) assert.equal(keyFromEnv(value), "", String(value));
  assert.equal(keyFromEnv(" tk_live_abc "), "tk_live_abc");
});

test("the seat map reports the venue map's capacity when the marketplace gives one", async () => {
  const body = { ...snap, venueLayout: { level: "seat", capacity: 16440, sections: [] } };
  const client = createClient({ apiKey: "k", fetchImpl: fake([{ status: 200, body }, { status: 200, body: snap }]) });
  assert.match(await getSeatMap(client, { url: "https://x" }), /Venue map capacity: 16440/);
  assert.match(await getSeatMap(client, { url: "https://x" }), /not given for this marketplace's map/);
});
