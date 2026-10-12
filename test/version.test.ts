import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The MCP server must report the package.json version, not a hardcoded copy that drifts.
test("MCP server version is read from package.json", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const line = src.split(/\r?\n/).find(l => l.includes("new McpServer("));
  assert.ok(line, "McpServer construction not found");
  assert.doesNotMatch(line!, /version:\s*["']\d+\.\d+\.\d+["']/);
});
