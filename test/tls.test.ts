// End-to-end TLS tests: the real SLA poller against a local HTTPS "PPDM" with
// a self-signed certificate. Certificates are generated per run with openssl,
// so no private key is ever committed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { runPpdmChecks } from "../src/sla-poller.js";
import { tlsAgent } from "../src/tls.js";

let dir: string;
let server: https.Server;
let port: number;
let serverCert: string;
let otherCert: string;
const requests: string[] = [];

function selfSigned(name: string): { key: string; cert: string } {
  const key = path.join(dir, `${name}.key`);
  const cert = path.join(dir, `${name}.pem`);
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout", key, "-out", cert,
  ], { stdio: "ignore" });
  return { key, cert };
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tls-test-"));
  const s = selfSigned("server");
  serverCert = s.cert;
  otherCert = selfSigned("other").cert;
  // Minimal PPDM: login returns a token, list endpoints return one empty page.
  server = https.createServer({ key: fs.readFileSync(s.key), cert: fs.readFileSync(s.cert) }, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ access_token: "t", content: [], page: { totalPages: 1 } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  PPDM_HOST: "127.0.0.1", PPDM_PORT: String(port), PPDM_USER: "u", PPDM_PASS: "p", ...extra,
});
const check = (e: NodeJS.ProcessEnv) =>
  runPpdmChecks({ windowHours: 24, storagePct: null }, { env: e, dispatch: async () => {} });


test("default: the poller refuses a self-signed PPDM and never sends credentials", async () => {
  requests.length = 0;
  await assert.rejects(check(env()), (err: { code?: string }) =>
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(err.code ?? ""));
  assert.deepEqual(requests, [], "no request may reach the server");
});

test("PPDM_CA_FILE with the appliance certificate: the poller runs, verified", async () => {
  requests.length = 0;
  const res = await check(env({ PPDM_CA_FILE: serverCert }));
  assert.equal(res.ran, true);
  assert.ok(requests.includes("POST /api/v2/login"));
});

test("PPDM_CA_FILE with an unrelated certificate: refused", async () => {
  await assert.rejects(check(env({ PPDM_CA_FILE: otherCert })));
});

test("there is no opt-out: PPDM_TLS_INSECURE is ignored", async () => {
  requests.length = 0;
  await assert.rejects(check(env({ PPDM_TLS_INSECURE: "true" })));
  assert.deepEqual(requests, [], "no request may reach the server");
});

test("an unreadable CA file fails loudly instead of falling back", async () => {
  await assert.rejects(check(env({ PPDM_CA_FILE: path.join(dir, "missing.pem") })), /PPDM_CA_FILE: cannot read/);
});

test("the default agent verifies certificates", () => {
  const opts = (tlsAgent("PPDM", {}) as unknown as { options: https.AgentOptions }).options;
  assert.notEqual(opts.rejectUnauthorized, false);
});

// ---- 2.0.1: TLS errors tell the user what to do -----------------------------

test("self-signed PPDM, no CA file: the poller error says to set PPDM_CA_FILE", async () => {
  await assert.rejects(check(env()), (err: Error) =>
    /PPDM's TLS certificate is not trusted\. If it is self-signed, set PPDM_CA_FILE/.test(err.message) &&
    /github\.com\/Moodswing9\/ppdm-alert-bot#tls-certificates/.test(err.message));
});

test("wrong CA file: the poller error says the CA file does not match", async () => {
  await assert.rejects(check(env({ PPDM_CA_FILE: otherCert })), /not signed by the certificate in PPDM_CA_FILE/);
});
