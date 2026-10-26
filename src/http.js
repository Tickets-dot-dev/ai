#!/usr/bin/env node
// Tickets.dev MCP server over Streamable HTTP, hosted at https://mcp.tickets.dev/mcp.
// Each caller sends their own key as `Authorization: Bearer <key>` (or
// `x-api-key`). It is held in memory for that session only and never logged.
// Sessions live in this process, so run a single instance.
import { createHash, randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { createClient } from "./tools.js";

export const HOSTED_NO_KEY_MESSAGE =
  "No Tickets.dev API key was sent. Ask the user to get one at https://tickets.dev/pricing and add it to " +
  "this MCP connection as an `Authorization: Bearer <key>` header. Never ask them to paste the key into the chat.";

const IDLE_MS = 30 * 60_000;
const MAX_SESSIONS = 2_000;
const MAX_BODY = 1_000_000;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "authorization, x-api-key, x-max-captures, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
};

function keyOf(req) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  return (bearer?.[1] ?? req.headers["x-api-key"] ?? "").trim();
}

const fingerprint = (key) => createHash("sha256").update(key).digest("hex");

function maxCapturesOf(req) {
  const n = Number(req.headers["x-max-captures"]);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 1_000) : 25;
}

function rpcError(res, status, message) {
  res.writeHead(status, { "content-type": "application/json" });
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

/** Starts the server; `fetchImpl` is for tests. Resolves to the node:http server. */
export function startServer({ port = Number(process.env.PORT || 8080), fetchImpl } = {}) {
  const sessions = new Map(); // id -> { transport, keyHash, lastSeen }

  const sweep = setInterval(() => {
    const cutoff = Date.now() - IDLE_MS;
    for (const { transport, lastSeen } of sessions.values()) if (lastSeen < cutoff) transport.close();
  }, 60_000);
  sweep.unref();

  async function handleMcp(req, res) {
    const key = keyOf(req);
    const id = req.headers["mcp-session-id"];

    if (id) {
      const session = sessions.get(id);
      if (!session) return rpcError(res, 404, "Session not found; start a new one.");
      if (session.keyHash !== fingerprint(key)) return rpcError(res, 403, "This session was opened with a different key.");
      session.lastSeen = Date.now();
      return session.transport.handleRequest(req, res);
    }

    if (req.method !== "POST") return rpcError(res, 400, "Send an initialize request first.");
    const body = await readJson(req);
    if (!isInitializeRequest(body)) return rpcError(res, 400, "Send an initialize request first.");
    if (sessions.size >= MAX_SESSIONS) return rpcError(res, 503, "Too many open sessions; try again shortly.");

    const client = createClient({
      apiKey: key,
      maxCaptures: maxCapturesOf(req),
      fetchImpl,
      noKeyMessage: HOSTED_NO_KEY_MESSAGE,
      budgetHint: "Start a new session, or send a higher x-max-captures header (each live capture is billed).",
      userAgent: "tickets-dev-mcp-hosted/0.1.0",
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { transport, keyHash: fingerprint(key), lastSeen: Date.now() });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await createServer(client).connect(transport);
    await transport.handleRequest(req, res, body);
  }

  const server = createHttpServer(async (req, res) => {
    for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
    const { pathname } = new URL(req.url, "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
      } else if (pathname === "/health") {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      } else if (pathname === "/mcp") {
        await handleMcp(req, res);
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
  server.on("close", () => {
    clearInterval(sweep);
    for (const { transport } of sessions.values()) transport.close();
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = await startServer();
  console.log(`Tickets.dev MCP listening on :${server.address().port}/mcp`);
}
