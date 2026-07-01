import axios from "axios";
import https from "https";
import { dispatch } from "./notifier.js";

interface Asset {
  id: string;
  name: string;
  type: string;
  protectionStatus: string;
  lastBackupTime?: string;
}

async function getPpdmToken(http: ReturnType<typeof axios.create>): Promise<string> {
  const res = await http.post("/login", {
    username: process.env.PPDM_USER,
    password: process.env.PPDM_PASS,
  });
  return res.data.access_token;
}

async function checkSlaBreaches(windowHours: number): Promise<void> {
  const host = process.env.PPDM_HOST;
  if (!host || !process.env.PPDM_USER || !process.env.PPDM_PASS) return;

  const http = axios.create({
    baseURL: `https://${host}:${Number(process.env.PPDM_PORT ?? 8443)}/api/v2`,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 30_000,
  });

  const token = await getPpdmToken(http);
  http.defaults.headers.common["Authorization"] = `Bearer ${token}`;

  const res = await http.get("/assets", { params: { pageSize: 200 } });
  const assets: Asset[] = res.data?.content ?? [];

  await http.post("/logout").catch(() => {});

  const cutoff = new Date(Date.now() - windowHours * 3600_000).toISOString();
  const breached = assets.filter(a => !a.lastBackupTime || a.lastBackupTime <= cutoff);

  for (const asset of breached) {
    await dispatch({
      severity: "WARNING",
      title: `SLA breach — ${asset.name}`,
      body: [
        `Asset:       ${asset.name} (${asset.type})`,
        `Last backup: ${asset.lastBackupTime ?? "never"}`,
        `Window:      ${windowHours}h`,
        `Action:      trigger on-demand backup or check policy assignment`,
      ].join("\n"),
      source: "PPDM",
      raw: asset as unknown as Record<string, unknown>,
    });
  }

  if (breached.length > 0) {
    console.log(`[SLA poller] ${breached.length} breach(es) detected and dispatched.`);
  } else {
    console.log(`[SLA poller] All ${assets.length} assets compliant.`);
  }
}

export function startSlaPoller(): void {
  const intervalMins = Number(process.env.SLA_POLL_INTERVAL_MINS ?? 60);
  const windowHours  = Number(process.env.SLA_WINDOW_HOURS ?? 24);

  if (process.env.ALERT_SLA_BREACH === "false") {
    console.log("[SLA poller] Disabled via ALERT_SLA_BREACH=false");
    return;
  }
  if (!process.env.PPDM_HOST) {
    console.log("[SLA poller] PPDM_HOST not set — skipping");
    return;
  }

  console.log(`[SLA poller] Starting — checking every ${intervalMins}m, window ${windowHours}h`);

  // Run immediately on start, then on interval
  checkSlaBreaches(windowHours).catch(e => console.error("[SLA poller] Error:", e.message));
  setInterval(
    () => checkSlaBreaches(windowHours).catch(e => console.error("[SLA poller] Error:", e.message)),
    intervalMins * 60_000,
  );
}
