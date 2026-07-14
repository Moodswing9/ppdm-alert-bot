# CLAUDE.md — ppdm-alert-bot

## What This Is

A TypeScript webhook receiver and MCP server that listens for Dell EMC **PPDM** and **NetWorker** events, classifies them by severity (CRITICAL / WARNING / INFO), and forwards structured alerts to **Slack** or **Microsoft Teams**.

Also exposes 4 MCP tools for use inside Claude Code: test alerts, inspect config, classify payloads, and on-demand SLA checks.

## Commands

```bash
# Install and build
npm install
npm run build

# Run the bot (HTTP + MCP over stdio)
npm start

# Add to Claude Code
claude mcp add ppdm-alert-bot npx ppdm-alert-bot

# Dev mode
npm run dev
```

## Webhook Endpoints

| Endpoint | Source |
|---|---|
| `POST /webhook/ppdm` | PPDM activity events |
| `POST /webhook/networker` | NetWorker saveset events |

Both endpoints accept JSON payloads. Secure with `WEBHOOK_SECRET` env var — bot checks `X-Webhook-Secret` header.

## MCP Tools (4)

| Tool | What it does |
|---|---|
| `send_test_alert` | Send a test CRITICAL/WARNING/INFO alert to verify Slack/Teams integration |
| `get_alert_config` | Show current config — port, destinations, thresholds |
| `classify_event` | Dry-run classify a raw JSON payload without sending an alert |
| `check_sla_now` | Immediately check PPDM SLA compliance and alert on any breached assets |

## Environment Variables

| Variable | Required for |
|---|---|
| `PORT` | HTTP server (default 4000) |
| `WEBHOOK_SECRET` | Validates `X-Webhook-Secret` header (optional but recommended) |
| `SLACK_WEBHOOK_URL` | Slack alerts |
| `TEAMS_WEBHOOK_URL` | Teams alerts |
| `ALERT_FAILED_JOBS` | Alert on failed jobs (default true) |
| `ALERT_SLA_BREACH` | Alert on SLA breaches (default true) |
| `ALERT_STORAGE_PCT` | DD capacity threshold (default 85) |
| `SLA_POLL_INTERVAL_MINS` | How often the SLA poller runs (default 60) |
| `SLA_WINDOW_HOURS` | Backup window for SLA compliance (default 24) |
| `PAGERDUTY_ROUTING_KEY` | PagerDuty Events API v2 routing key (CRITICAL alerts only) |
| `EMAIL_HOST`            | SMTP host for email alerts and digest |
| `EMAIL_PORT`            | SMTP port (default 587) |
| `EMAIL_USER`            | SMTP username |
| `EMAIL_PASS`            | SMTP password |
| `EMAIL_FROM`            | Sender address (defaults to EMAIL_USER) |
| `EMAIL_TO`              | Recipient address for alerts and digest |
| `DIGEST_HOUR`           | UTC hour for daily digest email (default 8) |

## Architecture

```
src/
├── index.ts        # HTTP webhook server + MCP server (4 tools)
├── classifier.ts   # classifyPpdmEvent / classifyNwEvent — severity logic
├── notifier.ts     # sendSlack / sendTeams / dispatch
└── sla-poller.ts   # Proactive SLA checker — polls PPDM on interval, alerts on breaches
```

## Severity Rules

| Condition | Severity |
|---|---|
| PPDM job FAILED | CRITICAL |
| PPDM job CANCELED | WARNING |
| PPDM job SUCCEEDED | INFO |
| NetWorker saveset failed (code 1) | CRITICAL |
| NetWorker saveset interrupted (code 2) | WARNING |
