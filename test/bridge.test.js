// Offline: the stdio bridge against a stand-in for https://api.tickets.dev/mcp.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// The remote's one tool reports the Authorization header it received.
let remote, remoteUrl;
before(async () => {
  remote = createServer(async (req, res) => {
    const server = new McpServer({ name: "remote", version: "0" });
    server.registerTool("whoami", { description: "Echoes the auth header" }, async (extra) => ({
      content: [{ type: "text", text: extra.requestInfo?.headers.authorization ?? "no key" }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise((resolve) => remote.listen(0, resolve));
  remoteUrl = `http://localhost:${remote.address().port}/mcp`;
});
after(() => remote.close());

async function connect(env) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../src/index.js", import.meta.url).pathname],
    env: { PATH: process.env.PATH, TICKETS_DEV_MCP_URL: remoteUrl, ...env },
  }));
  return client;
}
const text = (r) => r.content.map((c) => c.text).join("\n");

test("forwards tools and calls, with the key as a bearer header", async () => {
  const client = await connect({ TICKETS_DEV_KEY: "tk_live_x" });
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name), ["whoami"]);
  assert.equal(text(await client.callTool({ name: "whoami", arguments: {} })), "Bearer tk_live_x");
  await client.close();
});

test("sends no key when it is empty or an unexpanded placeholder", async () => {
  for (const TICKETS_DEV_KEY of ["", "${TICKETS_DEV_KEY}"]) {
    const client = await connect({ TICKETS_DEV_KEY });
    assert.equal(text(await client.callTool({ name: "whoami", arguments: {} })), "no key");
    await client.close();
  }
});

test("an unreachable server answers requests with an error instead of hanging", async () => {
  const client = new Client({ name: "test", version: "0" });
  const connecting = client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../src/index.js", import.meta.url).pathname],
    env: { PATH: process.env.PATH, TICKETS_DEV_MCP_URL: "http://127.0.0.1:9/mcp" },
  }));
  await assert.rejects(connecting, /Could not reach/);
  await client.close();
});

test("refuses a plain-HTTP server that isn't localhost", async () => {
  const client = new Client({ name: "test", version: "0" });
  const connecting = client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../src/index.js", import.meta.url).pathname],
    env: { PATH: process.env.PATH, TICKETS_DEV_KEY: "tk_live_x", TICKETS_DEV_MCP_URL: "http://example.com/mcp" },
    stderr: "pipe",
  }));
  await assert.rejects(connecting);
  await client.close();
});

test("a server that wants a key gets a clear message when none is set", async () => {
  const locked = createServer((req, res) => {
    res.writeHead(401, { "content-type": "application/json", "www-authenticate": 'Bearer resource_metadata="x"' });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Sign in" }, id: null }));
  });
  await new Promise((resolve) => locked.listen(0, resolve));
  try {
    const client = new Client({ name: "test", version: "0" });
    const connecting = client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [new URL("../src/index.js", import.meta.url).pathname],
      env: { PATH: process.env.PATH, TICKETS_DEV_MCP_URL: `http://localhost:${locked.address().port}/mcp` },
    }));
    await assert.rejects(connecting, /set TICKETS_DEV_KEY/);
    await client.close();
  } finally {
    locked.close();
  }
});
