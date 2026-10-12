import axios from "axios";
import https from "https";
import { dispatch as defaultDispatch } from "./notifier.js";
import type { Alert } from "./classifier.js";

export interface Asset {
  id: string;
  name: string;
  type: string;
  protectionStatus?: string;
  lastBackupTime?: string;
}

export interface StorageSystem {
  name: string;
  usedPct: number;
}

/** The subset of an axios instance the checks use, so tests can pass a fake. */
export interface PpdmHttp {
  get(url: string, config?: { params?: Record<string, unknown> }): Promise<{ data: any }>;
  post(url: string, body?: unknown): Promise<{ data: any }>;
}

export interface CheckOptions {
  windowHours: number;
  /** Storage alert threshold in percent, or null to skip the storage check. */
  storagePct: number | null;
  /** Skip the SLA check (storage only). */
  skipSla?: boolean;
}

export interface CheckDeps {
  http?: PpdmHttp;
  dispatch?: (alert: Alert) => Promise<void>;
  now?: number;
  env?: NodeJS.ProcessEnv;
}

export type CheckResult =
  | { ran: false; reason: string }
  | {
      ran: true;
      assetsChecked: number;
      slaBreaches: Asset[];
      storageChecked: number;
      storageBreaches: StorageSystem[];
    };

const PAGE_SIZE = 200;
const MAX_PAGES = 500;

/** Fetch every page of a PPDM list endpoint (pages are 0-based; stops at page.totalPages). */
export async function fetchAllPages<T>(http: PpdmHttp, path: string, pageSize = PAGE_SIZE): Promise<T[]> {
  const items: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await http.get(path, { params: { pageSize, page } });
    const data = res.data;
    if (Array.isArray(data)) return items.concat(data as T[]);
    const content: T[] = data?.content ?? [];
    items.push(...content);
    const totalPages = Number(data?.page?.totalPages ?? 1);
    if (page + 1 >= totalPages || content.length === 0) break;
  }
  return items;
}

/** Assets never backed up, or whose last backup is older than the window. */
export function findSlaBreaches(assets: Asset[], windowHours: number, now = Date.now()): Asset[] {
  const cutoff = now - windowHours * 3600_000;
  return assets.filter(a => {
    if (!a.lastBackupTime) return true;
    const t = Date.parse(a.lastBackupTime);
    return Number.isNaN(t) || t <= cutoff;
  });
}

/** Normalise PPDM storage-system records (same field mapping as ppdm-capacity-planner). */
export function parseStorageSystems(raw: Record<string, unknown>[]): StorageSystem[] {
  return raw.map(item => {
    const total = Number(item.totalCapacity ?? 0);
    const used = Number(item.usedCapacity ?? 0);
    const pct = item.usedPercentage !== undefined
      ? Number(item.usedPercentage)
      : total > 0 ? (used / total) * 100 : 0;
    return { name: String(item.name ?? item.id ?? "unknown"), usedPct: pct };
  });
}

export function findStorageBreaches(systems: StorageSystem[], thresholdPct: number): StorageSystem[] {
  return systems.filter(s => Number.isFinite(s.usedPct) && s.usedPct > thresholdPct);
}

/** ALERT_STORAGE_PCT: a number in (0, 100] enables the check; "off", "false" or 0 disables it. Default 85. */
export function parseStoragePct(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return 85;
  const v = value.trim().toLowerCase();
  if (v === "off" || v === "false") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return n;
}

function createHttp(env: NodeJS.ProcessEnv): PpdmHttp {
  return axios.create({
    baseURL: `https://${env.PPDM_HOST}:${Number(env.PPDM_PORT ?? 8443)}/api/v2`,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 30_000,
  });
}

/** Log in, run the SLA and storage checks, dispatch alerts, log out. Returns what was found. */
export async function runPpdmChecks(opts: CheckOptions, deps: CheckDeps = {}): Promise<CheckResult> {
  const env = deps.env ?? process.env;
  if (!env.PPDM_HOST || !env.PPDM_USER || !env.PPDM_PASS) {
    return { ran: false, reason: "PPDM_HOST, PPDM_USER and PPDM_PASS must all be set" };
  }
  const http = deps.http ?? createHttp(env);
  const send = deps.dispatch ?? defaultDispatch;
  const now = deps.now ?? Date.now();

  const login = await http.post("/login", { username: env.PPDM_USER, password: env.PPDM_PASS });
  const token = login.data?.access_token;
  const authed = http as PpdmHttp & { defaults?: { headers: { common: Record<string, string> } } };
  if (authed.defaults) authed.defaults.headers.common["Authorization"] = `Bearer ${token}`;

  let assets: Asset[] = [];
  let systems: StorageSystem[] = [];
  try {
    if (!opts.skipSla) assets = await fetchAllPages<Asset>(http, "/assets");
    if (opts.storagePct !== null) {
      systems = parseStorageSystems(await fetchAllPages<Record<string, unknown>>(http, "/storage-systems"));
    }
  } finally {
    await http.post("/logout").catch(() => {});
  }

  const slaBreaches = opts.skipSla ? [] : findSlaBreaches(assets, opts.windowHours, now);
  for (const asset of slaBreaches) {
    await send({
      kind: "sla_breach",
      severity: "WARNING",
      title: `SLA breach — ${asset.name}`,
      body: [
        `Asset:       ${asset.name} (${asset.type})`,
        `Last backup: ${asset.lastBackupTime ?? "never"}`,
        `Window:      ${opts.windowHours}h`,
        `Action:      trigger on-demand backup or check policy assignment`,
      ].join("\n"),
      source: "PPDM",
      raw: asset as unknown as Record<string, unknown>,
    });
  }

  const storageBreaches = opts.storagePct === null ? [] : findStorageBreaches(systems, opts.storagePct);
  for (const sys of storageBreaches) {
    await send({
      kind: "storage_capacity",
      severity: "WARNING",
      title: `Storage above ${opts.storagePct}% — ${sys.name}`,
      body: [
        `Storage system: ${sys.name}`,
        `Used:           ${sys.usedPct.toFixed(1)}%`,
        `Threshold:      ${opts.storagePct}%`,
        `Action:         review retention, clean up expired copies, or plan expansion`,
      ].join("\n"),
      source: "PPDM",
      raw: sys as unknown as Record<string, unknown>,
    });
  }

  return { ran: true, assetsChecked: assets.length, slaBreaches, storageChecked: systems.length, storageBreaches };
}

function logResult(result: CheckResult): void {
  if (!result.ran) return;
  console.error(
    `[PPDM poller] ${result.assetsChecked} assets checked, ${result.slaBreaches.length} SLA breach(es); ` +
    `${result.storageChecked} storage systems checked, ${result.storageBreaches.length} above threshold.`,
  );
}

export function startSlaPoller(env: NodeJS.ProcessEnv = process.env): void {
  const intervalMins = Number(env.SLA_POLL_INTERVAL_MINS ?? 60);
  const windowHours  = Number(env.SLA_WINDOW_HOURS ?? 24);
  const skipSla      = env.ALERT_SLA_BREACH === "false";
  const storagePct   = parseStoragePct(env.ALERT_STORAGE_PCT);

  if (!env.PPDM_HOST) {
    console.error("[PPDM poller] PPDM_HOST not set — skipping");
    return;
  }
  if (skipSla && storagePct === null) {
    console.error("[PPDM poller] Disabled: ALERT_SLA_BREACH=false and storage alerts off");
    return;
  }

  console.error(
    `[PPDM poller] Starting — every ${intervalMins}m; SLA ${skipSla ? "off" : `window ${windowHours}h`}; ` +
    `storage ${storagePct === null ? "off" : `threshold ${storagePct}%`}`,
  );

  const tick = () =>
    runPpdmChecks({ windowHours, storagePct, skipSla })
      .then(logResult)
      .catch(e => console.error("[PPDM poller] Error:", e.message));

  tick();
  setInterval(tick, intervalMins * 60_000);
}
