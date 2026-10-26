#!/usr/bin/env node
// Tickets.dev MCP server (stdio). Needs TICKETS_DEV_KEY; without it every tool
// explains how to add one. Captures are capped per session by
// TICKETS_DEV_MAX_CAPTURES (default 25).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { createClient } from "./tools.js";

await createServer(createClient()).connect(new StdioServerTransport());
