#!/usr/bin/env node
// Tickets.dev MCP server over Streamable HTTP, hosted at https://mcp.tickets.dev/mcp.
// Stateless: every request carries the caller's key (`Authorization: Bearer <key>`
// or `x-api-key`) and gets its own server, so nothing is lost on a redeploy and
// any number of instances can run. The key is never stored or logged.
import { createServer as createHttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { createClient } from "./tools.js";

export const HOSTED_NO_KEY_MESSAGE =
  "No Tickets.dev API key was sent. Ask the user to get one at https://tickets.dev/pricing and add it to " +
  "this MCP connection as an `Authorization: Bearer <key>` header. Never ask them to paste the key into the chat.";

// Enough for the largest single call (compare_prices captures at most 15 marketplaces).
const MAX_CAPTURES_PER_REQUEST = 15;
const MAX_BODY = 1_000_000;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, x-api-key, content-type, accept, mcp-protocol-version",
};

function keyOf(req) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  return (bearer?.[1] ?? req.headers["x-api-key"] ?? "").trim();
}

function rpcError(res, status, message, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Body is not valid JSON"), { status: 400 });
  }
}

async function handleMcp(req, res, fetchImpl) {
  // No sessions, so no server-initiated stream (GET) and nothing to end (DELETE).
  if (req.method !== "POST") return rpcError(res, 405, "Method not allowed", { allow: "POST" });
  const body = await readJson(req);
  const client = createClient({
    apiKey: keyOf(req),
    maxCaptures: MAX_CAPTURES_PER_REQUEST,
    fetchImpl,
    noKeyMessage: HOSTED_NO_KEY_MESSAGE,
    budgetHint: "Split the work across several calls.",
    userAgent: "tickets-dev-mcp-hosted/0.1.0",
    scope: "in this call",
  });
  const server = createServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

/** Starts the server; `fetchImpl` is for tests. Resolves to the node:http server. */
export function startServer({ port = Number(process.env.PORT || 8080), fetchImpl } = {}) {
  const server = createHttpServer(async (req, res) => {
    for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
    const { pathname } = new URL(req.url, "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
      } else if (pathname === "/health") {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      } else if (pathname === "/mcp") {
        await handleMcp(req, res, fetchImpl);
      } else if (pathname === "/") {
        res.writeHead(302, { location: "https://github.com/Tickets-dot-dev/ai#mcp-server" }).end();
      } else {
        res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      }
    } catch (error) {
      // Only the message: never the request, whose headers carry the caller's key.
      if (!error.status) console.error(`mcp error: ${error.message}`);
      if (!res.headersSent) rpcError(res, error.status ?? 500, error.status ? error.message : "Internal error");
      else res.end();
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = await startServer();
  console.log(`Tickets.dev MCP listening on :${server.address().port}/mcp`);
  // On a deploy, stop taking requests and let calls in flight finish.
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
