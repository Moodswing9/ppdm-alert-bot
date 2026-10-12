#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createRequire } from "module";
import { config } from "dotenv";
import { classifyPpdmEvent, classifyNwEvent, isSuppressed } from "./classifier.js";
import { dispatch } from "./notifier.js";
import { startSlaPoller, runPpdmChecks, parseStoragePct } from "./sla-poller.js";
import { recordAlert, startDigestScheduler } from "./digest-scheduler.js";

config();

const PORT   = Number(process.env.PORT ?? 4000);
const SECRET = process.env.WEBHOOK_SECRET ?? "";

// ── Webhook HTTP server ───────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => res(body));
    req.on("error", rej);
  });
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== "POST") { res.writeHead(405).end("Method Not Allowed"); return; }

  if (SECRET && req.headers["x-webhook-secret"] !== SECRET) {
    res.writeHead(401).end("Unauthorized");
    return;
  }

  const body = await readBody(req);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(body); }
  catch { res.writeHead(400).end("Bad JSON"); return; }

  const source = req.url?.includes("networker") ? "nw" : "ppdm";
  const alert  = source === "nw"
    ? classifyNwEvent(payload)
    : classifyPpdmEvent(payload);

  if (alert && isSuppressed(alert)) {
    console.error(`[${new Date().toISOString()}] suppressed (ALERT_FAILED_JOBS=false) — ${alert.title}`);
  } else if (alert) {
    console.error(`[${new Date().toISOString()}] ${alert.severity} — ${alert.title}`);
    dispatch(alert).catch(e => console.error("Dispatch error:", e.message));
    recordAlert(alert);
  }

  res.writeHead(200).end("OK");
});

httpServer.listen(PORT, () => {
  console.error(`ppdm-alert-bot listening on port ${PORT}`);
  console.error(`  POST /webhook/ppdm      — PPDM events`);
  console.error(`  POST /webhook/networker — NetWorker events`);
  startSlaPoller();
  startDigestScheduler();
});

// ── MCP server ────────────────────────────────────────────────────────────────

// package.json sits one level above both src/ (tsx) and dist/ (built)
const { version: VERSION } = createRequire(import.meta.url)("../package.json") as { version: string };

const mcp = new McpServer({ name: "ppdm-alert-bot", version: VERSION });

mcp.tool(
  "send_test_alert",
  "Send a test alert to configured Slack/Teams destinations to verify the integration is working.",
  {
    severity: z.enum(["CRITICAL", "WARNING", "INFO"]).optional().default("INFO"),
    message:  z.string().optional().default("This is a test alert from ppdm-alert-bot."),
  },
  async ({ severity, message }) => {
    await dispatch({
      severity: severity as "CRITICAL" | "WARNING" | "INFO",
      title: `Test alert — ${severity}`,
      body:  message ?? "Test alert from ppdm-alert-bot.",
      source: "PPDM",
      kind: "test",
      raw: {},
    });
    return {
      content: [{ type: "text", text: `Test ${severity} alert dispatched to configured destinations.` }],
    };
  },
);

mcp.tool(
  "get_alert_config",
  "Show the current alert bot configuration — listening port, destinations, and severity thresholds.",
  {},
  async () => {
    const env = process.env;
    const set = (v: string | undefined) => (v ? "✅ configured" : "❌ not set");
    const storagePct = parseStoragePct(env.ALERT_STORAGE_PCT);
    const ppdm = env.PPDM_HOST && env.PPDM_USER && env.PPDM_PASS
      ? `✅ ${env.PPDM_HOST}:${env.PPDM_PORT ?? 8443}`
      : "❌ not set (PPDM_HOST, PPDM_USER, PPDM_PASS)";
    const email = env.EMAIL_HOST && env.EMAIL_USER && env.EMAIL_PASS && env.EMAIL_TO ? "✅ configured" : "❌ not set";
    return {
      content: [{
        type: "text",
        text: [
          "ppdm-alert-bot configuration",
          "",
          `Port:              ${PORT}`,
          `Webhook secret:    ${SECRET ? "✅ set" : "❌ not set (open)"}`,
          `Slack:             ${set(env.SLACK_WEBHOOK_URL)}`,
          `Teams:             ${set(env.TEAMS_WEBHOOK_URL)}`,
          `PagerDuty:         ${set(env.PAGERDUTY_ROUTING_KEY)}`,
          `Email:             ${email}`,
          `PPDM connection:   ${ppdm}`,
          `Failed-job alerts: ${env.ALERT_FAILED_JOBS === "false" ? "off" : "on"}`,
          `SLA checks:        ${env.ALERT_SLA_BREACH === "false" ? "off" : `on — ${env.SLA_WINDOW_HOURS ?? 24}h window, every ${env.SLA_POLL_INTERVAL_MINS ?? 60}m`}`,
          `Storage alerts:    ${storagePct === null ? "off" : `above ${storagePct}%`}`,
          `Daily digest:      ${email.startsWith("✅") ? `${env.DIGEST_HOUR ?? 8}:00 UTC` : "off (needs email)"}`,
        ].join("\n"),
      }],
    };
  },
);

mcp.tool(
  "classify_event",
  "Classify a raw PPDM or NetWorker webhook payload and return what alert would be sent without actually sending it.",
  {
    source:  z.enum(["ppdm", "networker"]).describe("Event source"),
    payload: z.string().describe("Raw JSON payload as a string"),
  },
  async ({ source, payload }) => {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(payload); }
    catch { return { content: [{ type: "text", text: "Invalid JSON payload." }] }; }

    const alert = source === "networker" ? classifyNwEvent(parsed) : classifyPpdmEvent(parsed);
    if (!alert) {
      return { content: [{ type: "text", text: "No alert would be generated for this payload (INFO or unrecognised state)." }] };
    }
    return {
      content: [{
        type: "text",
        text: `Severity: ${alert.severity}\nTitle:    ${alert.title}\n\n${alert.body}`,
      }],
    };
  },
);

mcp.tool(
  "check_sla_now",
  "Immediately check PPDM SLA compliance and dispatch alerts for any breached assets — runs the same check as the scheduled poller but on demand.",
  {
    window_hours: z.number().optional().default(24).describe("Compliance window in hours (default 24)"),
  },
  async ({ window_hours }) => {
    try {
      const result = await runPpdmChecks({ windowHours: window_hours, storagePct: null });
      if (!result.ran) {
        return { content: [{ type: "text", text: `SLA check not run: ${result.reason}.` }] };
      }
      const names = result.slaBreaches.slice(0, 20).map(a => `  - ${a.name} (last backup: ${a.lastBackupTime ?? "never"})`);
      const more = result.slaBreaches.length > 20 ? [`  … and ${result.slaBreaches.length - 20} more`] : [];
      const text = result.slaBreaches.length === 0
        ? `All ${result.assetsChecked} assets have a backup within the last ${window_hours}h. No alerts sent.`
        : [`${result.slaBreaches.length} of ${result.assetsChecked} assets have no backup within ${window_hours}h. A WARNING alert was sent for each:`, ...names, ...more].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `SLA check failed: ${(e as Error).message}` }] };
    }
  },
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
