import axios from "axios";
import type { Alert, Severity } from "./classifier.js";

const EMOJI: Record<Severity, string> = {
  CRITICAL: "🔴",
  WARNING:  "🟡",
  INFO:     "🟢",
};

export async function sendSlack(webhookUrl: string, alert: Alert): Promise<void> {
  const color = alert.severity === "CRITICAL" ? "#e53e3e"
              : alert.severity === "WARNING"  ? "#d69e2e"
              : "#38a169";

  await axios.post(webhookUrl, {
    attachments: [{
      color,
      title: `${EMOJI[alert.severity]} [${alert.source}] ${alert.title}`,
      text:  alert.body,
      footer: "ppdm-alert-bot",
      ts: Math.floor(Date.now() / 1000),
    }],
  });
}

export async function sendTeams(webhookUrl: string, alert: Alert): Promise<void> {
  const themeColor = alert.severity === "CRITICAL" ? "e53e3e"
                   : alert.severity === "WARNING"  ? "d69e2e"
                   : "38a169";

  await axios.post(webhookUrl, {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor,
    summary: alert.title,
    sections: [{
      activityTitle: `${EMOJI[alert.severity]} [${alert.source}] ${alert.title}`,
      activityText:  alert.body.replace(/\n/g, "<br>"),
      facts: [{ name: "Severity", value: alert.severity }],
    }],
  });
}

export async function sendPagerDuty(routingKey: string, alert: Alert): Promise<void> {
  const pdSeverity =
    alert.severity === "CRITICAL" ? "critical" :
    alert.severity === "WARNING"  ? "warning"  : "info";

  await axios.post("https://events.pagerduty.com/v2/enqueue", {
    routing_key:  routingKey,
    event_action: "trigger",
    dedup_key:    `ppdm-alert-bot-${alert.source}-${Date.now()}`,
    payload: {
      summary:  `[${alert.source}] ${alert.title}`,
      severity: pdSeverity,
      source:   "ppdm-alert-bot",
      custom_details: { body: alert.body },
    },
  });
}

export async function sendEmailAlert(alert: Alert): Promise<void> {
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT ?? 587);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const from = process.env.EMAIL_FROM ?? user;
  const to   = process.env.EMAIL_TO;
  if (!host || !user || !pass || !to) return;

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({ host, port, auth: { user, pass } });
  await transporter.sendMail({
    from,
    to,
    subject: `${EMOJI[alert.severity]} [ppdm-alert-bot] ${alert.title}`,
    text: `${alert.title}\n\n${alert.body}\n\nSource: ${alert.source}\nSeverity: ${alert.severity}`,
  });
}

export async function dispatch(alert: Alert): Promise<void> {
  const slackUrl  = process.env.SLACK_WEBHOOK_URL;
  const teamsUrl  = process.env.TEAMS_WEBHOOK_URL;
  const pdKey     = process.env.PAGERDUTY_ROUTING_KEY;

  const sends: Promise<void>[] = [];
  if (slackUrl) sends.push(sendSlack(slackUrl, alert).catch(e => console.error("Slack error:", e.message)));
  if (teamsUrl) sends.push(sendTeams(teamsUrl, alert).catch(e => console.error("Teams error:", e.message)));
  if (pdKey && alert.severity === "CRITICAL") sends.push(sendPagerDuty(pdKey, alert).catch(e => console.error("PagerDuty error:", e.message)));
  if (alert.severity !== "INFO") sends.push(sendEmailAlert(alert).catch(e => console.error("Email error:", e.message)));
  if (sends.length === 0) console.warn("No alert destinations configured.");
  await Promise.all(sends);
}
