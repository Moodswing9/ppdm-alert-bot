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

export async function dispatch(alert: Alert): Promise<void> {
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  const teamsUrl = process.env.TEAMS_WEBHOOK_URL;

  const sends: Promise<void>[] = [];
  if (slackUrl) sends.push(sendSlack(slackUrl, alert).catch(e => console.error("Slack error:", e.message)));
  if (teamsUrl) sends.push(sendTeams(teamsUrl, alert).catch(e => console.error("Teams error:", e.message)));
  if (sends.length === 0) console.warn("No alert destinations configured (SLACK_WEBHOOK_URL or TEAMS_WEBHOOK_URL)");
  await Promise.all(sends);
}
