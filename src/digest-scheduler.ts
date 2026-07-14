import { sendEmailAlert } from "./notifier.js";
import type { Alert } from "./classifier.js";

type TimestampedAlert = Alert & { timestamp: string };

const recentAlerts: TimestampedAlert[] = [];

export function recordAlert(alert: Alert): void {
  recentAlerts.push({ ...alert, timestamp: new Date().toISOString() });
  // Keep only last 24h
  const cutoff = Date.now() - 86_400_000;
  while (recentAlerts.length > 0) {
    const first = recentAlerts[0];
    if (new Date(first.timestamp).getTime() < cutoff) {
      recentAlerts.shift();
    } else break;
  }
}

export function startDigestScheduler(): void {
  const to = process.env.EMAIL_TO;
  if (!to || !process.env.EMAIL_HOST) return;

  const targetHour = Number(process.env.DIGEST_HOUR ?? 8);

  function scheduleNextDigest(): void {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(targetHour, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const delay = next.getTime() - now.getTime();
    setTimeout(async () => {
      await sendDigest();
      scheduleNextDigest();
    }, delay);
  }

  async function sendDigest(): Promise<void> {
    const critical = recentAlerts.filter(a => a.severity === "CRITICAL").length;
    const warning  = recentAlerts.filter(a => a.severity === "WARNING").length;
    const info     = recentAlerts.filter(a => a.severity === "INFO").length;
    const total    = recentAlerts.length;

    const body = total === 0
      ? "No alerts in the last 24 hours. All systems appear healthy."
      : `Summary for the last 24 hours:\n\n` +
        `  🔴 CRITICAL: ${critical}\n` +
        `  🟡 WARNING:  ${warning}\n` +
        `  🟢 INFO:     ${info}\n\n` +
        `Recent alerts:\n` +
        recentAlerts.slice(-10).map(a => `  [${a.severity}] ${a.title}`).join("\n");

    await sendEmailAlert({
      severity: critical > 0 ? "CRITICAL" : warning > 0 ? "WARNING" : "INFO",
      title: `Daily Digest — ${total} alert(s) in 24h`,
      body,
      source: "PPDM",
      raw: {},
    });
    console.log(`[digest] Sent daily digest: ${critical} critical, ${warning} warning, ${info} info`);
  }

  scheduleNextDigest();
  console.log(`[digest] Daily digest scheduled at ${targetHour}:00 UTC`);
}
