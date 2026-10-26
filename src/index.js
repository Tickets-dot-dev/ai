#!/usr/bin/env node
// Tickets.dev MCP over stdio, for clients that only start local servers. It
// forwards every message to the hosted server at https://api.tickets.dev/mcp,
// where the tools live, with the key from TICKETS_DEV_KEY. Without a key the
// tools still list, and each call explains how to add one.
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export const MCP_URL = process.env.TICKETS_DEV_MCP_URL || "https://api.tickets.dev/mcp";

/** The key from the environment, or "" when none is really set. Plugin hosts
 * can pass an empty string or an unexpanded `${...}` placeholder. */
export function keyFromEnv(value = process.env.TICKETS_DEV_KEY) {
  const key = (value ?? "").trim();
  return !key || key.includes("${") ? "" : key;
}

const key = keyFromEnv();
const remote = new StreamableHTTPClientTransport(new URL(MCP_URL), {
  requestInit: {
    headers: { "user-agent": "tickets-dev-mcp-bridge/0.1.0", ...(key && { authorization: `Bearer ${key}` }) },
  },
});
const local = new StdioServerTransport();

local.onmessage = async (message) => {
  try {
    await remote.send(message);
  } catch (error) {
    // A request must get an answer, or the client waits forever.
    if ("id" in message && "method" in message) {
      await local.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: `Could not reach ${MCP_URL}: ${error.message}` },
      });
    }
  }
};
remote.onmessage = (message) => local.send(message);
local.onclose = () => remote.close();

await remote.start();
await local.start();
