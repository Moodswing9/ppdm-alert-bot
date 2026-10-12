import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchAllPages,
  findSlaBreaches,
  parseStorageSystems,
  findStorageBreaches,
  parseStoragePct,
  runPpdmChecks,
  type PpdmHttp,
  type Asset,
} from "../src/sla-poller.js";
import type { Alert } from "../src/classifier.js";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

/** Fake PPDM: serves paged GETs from fixed data and records every call. */
function fakePpdm(routes: Record<string, unknown[]>, pageSizeOverride?: number) {
  const calls: string[] = [];
  const http: PpdmHttp = {
    async get(url, config) {
      const page = Number(config?.params?.page ?? 0);
      const size = pageSizeOverride ?? Number(config?.params?.pageSize ?? 200);
      calls.push(`GET ${url} page=${page}`);
      const all = routes[url] ?? [];
      return {
        data: {
          content: all.slice(page * size, (page + 1) * size),
          page: { number: page, size, totalPages: Math.max(1, Math.ceil(all.length / size)) },
        },
      };
    },
    async post(url) {
      calls.push(`POST ${url}`);
      return { data: url === "/login" ? { access_token: "t" } : {} };
    },
  };
  return { http, calls };
}

const PPDM_ENV = { PPDM_HOST: "ppdm", PPDM_USER: "u", PPDM_PASS: "p" };

test("fetchAllPages walks every page until totalPages", async () => {
  const assets = Array.from({ length: 450 }, (_, i) => ({ id: String(i) }));
  const { http, calls } = fakePpdm({ "/assets": assets });
  const got = await fetchAllPages(http, "/assets");
  assert.equal(got.length, 450);
  assert.deepEqual(calls, ["GET /assets page=0", "GET /assets page=1", "GET /assets page=2"]);
});

test("fetchAllPages handles a single page, a missing page object and a bare array", async () => {
  const { http } = fakePpdm({ "/assets": [{ id: "a" }] });
  assert.equal((await fetchAllPages(http, "/assets")).length, 1);

  const noPage: PpdmHttp = { get: async () => ({ data: { content: [{ id: "x" }] } }), post: async () => ({ data: {} }) };
  assert.equal((await fetchAllPages(noPage, "/assets")).length, 1);

  const bare: PpdmHttp = { get: async () => ({ data: [{ id: "y" }, { id: "z" }] }), post: async () => ({ data: {} }) };
  assert.equal((await fetchAllPages(bare, "/assets")).length, 2);
});

test("findSlaBreaches flags never-backed-up, stale and unparseable assets only", () => {
  const assets: Asset[] = [
    { id: "1", name: "never", type: "VM" },
    { id: "2", name: "stale", type: "VM", lastBackupTime: hoursAgo(30) },
    { id: "3", name: "fresh", type: "VM", lastBackupTime: hoursAgo(2) },
    { id: "4", name: "garbage", type: "VM", lastBackupTime: "not-a-date" },
    { id: "5", name: "exactly-at-cutoff", type: "VM", lastBackupTime: hoursAgo(24) },
  ];
  const names = findSlaBreaches(assets, 24, NOW).map(a => a.name);
  assert.deepEqual(names, ["never", "stale", "garbage", "exactly-at-cutoff"]);
});

test("findSlaBreaches compares real timestamps, not strings with different offsets", () => {
  // 13:00+02:00 is 11:00Z — 1 hour before NOW, so inside a 24h window
  const assets: Asset[] = [{ id: "1", name: "offset", type: "VM", lastBackupTime: "2026-10-12T13:00:00+02:00" }];
  assert.equal(findSlaBreaches(assets, 24, NOW).length, 0);
});

test("parseStorageSystems uses usedPercentage, else computes it from capacity", () => {
  const systems = parseStorageSystems([
    { name: "dd1", usedPercentage: 91.5 },
    { name: "dd2", totalCapacity: 200, usedCapacity: 50 },
    { id: "dd3", totalCapacity: 0, usedCapacity: 0 },
  ]);
  assert.deepEqual(systems, [
    { name: "dd1", usedPct: 91.5 },
    { name: "dd2", usedPct: 25 },
    { name: "dd3", usedPct: 0 },
  ]);
});

test("findStorageBreaches is strictly above the threshold", () => {
  const systems = [{ name: "a", usedPct: 85 }, { name: "b", usedPct: 85.1 }, { name: "c", usedPct: NaN }];
  assert.deepEqual(findStorageBreaches(systems, 85).map(s => s.name), ["b"]);
});

test("parseStoragePct: default 85, numbers, and the ways to turn it off", () => {
  assert.equal(parseStoragePct(undefined), 85);
  assert.equal(parseStoragePct(""), 85);
  assert.equal(parseStoragePct("90"), 90);
  assert.equal(parseStoragePct("off"), null);
  assert.equal(parseStoragePct("false"), null);
  assert.equal(parseStoragePct("0"), null);
  assert.equal(parseStoragePct("150"), null);
  assert.equal(parseStoragePct("abc"), null);
});

test("runPpdmChecks does not run without PPDM credentials", async () => {
  const result = await runPpdmChecks({ windowHours: 24, storagePct: 85 }, { env: { PPDM_HOST: "ppdm" } });
  assert.equal(result.ran, false);
});

test("runPpdmChecks checks every asset, alerts on SLA and storage breaches, and logs out", async () => {
  const assets = [
    ...Array.from({ length: 250 }, (_, i) => ({ id: `ok${i}`, name: `ok${i}`, type: "VM", lastBackupTime: hoursAgo(1) })),
    { id: "late", name: "late-vm", type: "VM", lastBackupTime: hoursAgo(48) },
  ];
  const storage = [{ name: "dd-full", usedPercentage: 97 }, { name: "dd-ok", usedPercentage: 40 }];
  const { http, calls } = fakePpdm({ "/assets": assets, "/storage-systems": storage });
  const sent: Alert[] = [];

  const result = await runPpdmChecks(
    { windowHours: 24, storagePct: 85 },
    { http, env: PPDM_ENV, now: NOW, dispatch: async a => { sent.push(a); } },
  );

  assert.ok(result.ran);
  if (!result.ran) return;
  assert.equal(result.assetsChecked, 251, "assets beyond the first page are checked");
  assert.deepEqual(result.slaBreaches.map(a => a.name), ["late-vm"]);
  assert.deepEqual(result.storageBreaches.map(s => s.name), ["dd-full"]);
  assert.deepEqual(sent.map(a => [a.kind, a.severity]), [["sla_breach", "WARNING"], ["storage_capacity", "WARNING"]]);
  assert.equal(calls[0], "POST /login");
  assert.equal(calls.at(-1), "POST /logout");
});

test("runPpdmChecks with storagePct null skips the storage endpoint (check_sla_now path)", async () => {
  const { http, calls } = fakePpdm({ "/assets": [], "/storage-systems": [{ name: "dd", usedPercentage: 99 }] });
  const sent: Alert[] = [];
  const result = await runPpdmChecks(
    { windowHours: 24, storagePct: null },
    { http, env: PPDM_ENV, now: NOW, dispatch: async a => { sent.push(a); } },
  );
  assert.ok(result.ran);
  assert.equal(calls.some(c => c.includes("/storage-systems")), false);
  assert.equal(sent.length, 0);
});

test("runPpdmChecks logs out even when fetching fails", async () => {
  const calls: string[] = [];
  const http: PpdmHttp = {
    get: async () => { throw new Error("boom"); },
    post: async url => { calls.push(url); return { data: { access_token: "t" } }; },
  };
  await assert.rejects(runPpdmChecks({ windowHours: 24, storagePct: null }, { http, env: PPDM_ENV }), /boom/);
  assert.deepEqual(calls, ["/login", "/logout"]);
});
