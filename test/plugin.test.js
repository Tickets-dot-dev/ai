// The plugin manifests and skills parse, agree on name and version, and run
// the published package.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const json = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const pkg = json("package.json");

test("manifests share the package version and name", () => {
  for (const path of ["plugin.json", ".cursor-plugin/plugin.json", ".claude-plugin/plugin.json", ".grok-plugin/plugin.json", "gemini-extension.json"]) {
    const manifest = json(path);
    assert.equal(manifest.name, "tickets-dev", path);
    assert.equal(manifest.version, pkg.version, path);
  }
  assert.equal(json(".claude-plugin/marketplace.json").plugins[0].version, pkg.version);
  assert.equal(json(".grok-plugin/marketplace.json").plugins[0].version, pkg.version);
  assert.equal(json(".agents/plugins/marketplace.json").plugins[0].source.path, "./");
});

test("every MCP config starts the published package", () => {
  for (const path of ["mcp.json", ".mcp.json", "gemini-extension.json"]) {
    const server = json(path).mcpServers["tickets-dev"];
    assert.deepEqual(server.args, ["-y", pkg.name], path);
    assert.equal(server.env, undefined, `${path}: no key in the config; it comes from the user's environment`);
  }
});

test("each skill has a name matching its folder and a description", () => {
  const dir = new URL("../skills/", import.meta.url);
  for (const name of readdirSync(dir)) {
    const text = readFileSync(new URL(`${name}/SKILL.md`, dir), "utf8");
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .{40,}`), name);
  }
});

test("server.json matches the npm package for the MCP registry", () => {
  const server = json("server.json");
  assert.equal(server.name, pkg.mcpName);
  assert.equal(server.version, pkg.version);
  assert.ok(server.description.length <= 100);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
  assert.ok(server.packages[0].environmentVariables.find((v) => v.name === "TICKETS_DEV_KEY" && v.isRequired && v.isSecret));
});
