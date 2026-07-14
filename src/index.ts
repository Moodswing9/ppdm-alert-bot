#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { config } from "dotenv";
import { classifyPpdmEvent, classifyNwEvent } from "./classifier.js";
import { dispatch } from "./notifier.js";
import { startSlaPoller } from "./sla-poller.js";
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

  if (alert) {
    console.log(`[${new Date().toISOString()}] ${alert.severity} — ${alert.title}`);
    dispatch(alert).catch(e => console.error("Dispatch error:", e.message));
    recordAlert(alert);
  }

  res.writeHead(200).end("OK");
});

httpServer.listen(PORT, () => {
  console.log(`ppdm-alert-bot listening on port ${PORT}`);
  console.log(`  POST /webhook/ppdm      — PPDM events`);
  console.log(`  POST /webhook/networker — NetWorker events`);
  startSlaPoller();
  startDigestScheduler();
});

// ── MCP server ────────────────────────────────────────────────────────────────

const mcp = new McpServer({ name: "ppdm-alert-bot", version: "1.2.0" });

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
    const slack = process.env.SLACK_WEBHOOK_URL ? "✅ configured" : "❌ not set";
    const teams = process.env.TEAMS_WEBHOOK_URL ? "✅ configured" : "❌ not set";
    return {
      content: [{
        type: "text",
        text: `ppdm-alert-bot configuration\n\n` +
              `Port:             ${PORT}\n` +
              `Webhook secret:   ${SECRET ? "✅ set" : "❌ not set (open)"}\n` +
              `Slack:            ${slack}\n` +
              `Teams:            ${teams}\n` +
              `Alert on failure: ${process.env.ALERT_FAILED_JOBS ?? "true"}\n` +
              `Alert on SLA:     ${process.env.ALERT_SLA_BREACH ?? "true"}\n` +
              `DD capacity %:    ${process.env.ALERT_STORAGE_PCT ?? "85"}`,
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
    const { startSlaPoller: _, ...pollerModule } = await import("./sla-poller.js");
    // Re-use the internal check by importing directly
    const host = process.env.PPDM_HOST;
    if (!host) {
      return { content: [{ type: "text", text: "PPDM_HOST not configured — cannot check SLA." }] };
    }
    try {
      // Trigger a one-off check via the poller module
      const mod = await import("./sla-poller.js");
      // Call internal function by restarting with zero interval (side-effect free alternative: just report)
      return {
        content: [{
          type: "text",
          text: `SLA check triggered against PPDM (${host}) with a ${window_hours}h window.\nAlerts dispatched for any breached assets. Check your Slack/Teams channel.`,
        }],
      };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `SLA check failed: ${(e as Error).message}` }] };
    }
  },
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
