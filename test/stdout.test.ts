import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// stdout carries the MCP stdio protocol, so source code must log to stderr only.
test("src never writes logs to stdout", () => {
  const dir = join(import.meta.dirname, "..", "src");
  const offenders = readdirSync(dir)
    .filter(f => f.endsWith(".ts"))
    .flatMap(f =>
      readFileSync(join(dir, f), "utf8")
        .split(/\r?\n/)
        .map((line, i) => ({ f, i: i + 1, line }))
        .filter(({ line }) => /console\.(log|info|debug)\(|process\.stdout\.write/.test(line)),
    )
    .map(({ f, i }) => `${f}:${i}`);
  assert.deepEqual(offenders, []);
});
