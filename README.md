<div align="center">

# 🚨 ppdm-alert-bot

**Backup alerting for Dell PowerProtect Data Manager (PPDM) and NetWorker — Slack, Teams, PagerDuty and email, with an MCP server for Claude Code**

[![Version](https://img.shields.io/badge/version-1.2.0-6366f1?style=flat-square)](https://github.com/Moodswing9/ppdm-alert-bot/releases)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/Moodswing9/ppdm-alert-bot/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Moodswing9/ppdm-alert-bot/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-20%2B-3b82f6?style=flat-square)](#requirements)

</div>

---

## Overview

`ppdm-alert-bot` turns PPDM and NetWorker events into alerts your team actually sees:

- **Webhook receiver** — accepts PPDM job events and NetWorker save set events over HTTP, classifies each one as CRITICAL, WARNING or INFO, and forwards it to the destinations you configure.
- **Proactive PPDM checks** — periodically asks PPDM which assets haven't been backed up within your window, and which storage systems are filling up, and raises a WARNING for each one.
- **Daily digest** — emails a summary of the last 24 hours of alerts at a fixed UTC hour.
- **MCP server** — lets Claude Code send test alerts, inspect the configuration and dry-run the classifier.

---

## Requirements

- Node.js 20+ (CI runs on 22 and 24)
- At least one destination: a Slack incoming webhook, a Teams incoming webhook, a PagerDuty Events API v2 routing key, or an SMTP account
- For SLA and storage checks: network access to the PPDM REST API and an account that can read assets and storage systems

---

## Quick start

```bash
git clone https://github.com/Moodswing9/ppdm-alert-bot.git
cd ppdm-alert-bot
npm install
npm run build

cp .env.example .env    # then fill in your values
npm start
```

The bot loads `.env` automatically. On start it listens for webhooks (port 4000 by default), starts the PPDM poller and digest scheduler if they're configured, and serves its MCP tools over stdio. Log output goes to stderr.

Then point PPDM and NetWorker at the bot:

| Source | URL |
|:---|:---|
| PPDM | `http://<bot-host>:4000/webhook/ppdm` |
| NetWorker | `http://<bot-host>:4000/webhook/networker` |

If `WEBHOOK_SECRET` is set, every request must send the same value in an `X-Webhook-Secret` header, otherwise it is rejected with 401.

---

## What gets alerted

| Event | Severity |
|:---|:---|
| PPDM job failed | 🔴 CRITICAL |
| PPDM job canceled | 🟡 WARNING |
| PPDM job succeeded | 🟢 INFO |
| NetWorker save set failed (status `failed` or code `1`) | 🔴 CRITICAL |
| NetWorker save set interrupted (status `interrupted` or code `2`) | 🟡 WARNING |
| PPDM asset with no backup inside the SLA window (PPDM poller) | 🟡 WARNING |
| PPDM storage system above `ALERT_STORAGE_PCT` (PPDM poller) | 🟡 WARNING |

Other PPDM event types and states are ignored. Set `ALERT_FAILED_JOBS=false` to stop alerting on failed jobs from both PPDM and NetWorker.

### Where each severity goes

| Destination | CRITICAL | WARNING | INFO |
|:---|:---:|:---:|:---:|
| Slack | ✅ | ✅ | ✅ |
| Teams | ✅ | ✅ | ✅ |
| PagerDuty | ✅ | — | — |
| Email | ✅ | ✅ | — |

Slack and Teams receive INFO alerts too, which means one message per successful PPDM backup. On a busy server, consider a dedicated channel.

---

## Configuration

All settings are environment variables, read from the shell or from `.env`.

### Webhook listener

| Variable | Description | Default |
|:---|:---|:---|
| `PORT` | HTTP port for webhooks | `4000` |
| `WEBHOOK_SECRET` | Shared secret expected in the `X-Webhook-Secret` header. Strongly recommended; without it the endpoint accepts anyone's requests | — |
| `ALERT_FAILED_JOBS` | Set to `false` to suppress failed-job alerts (PPDM and NetWorker) | `true` |

### Destinations (set at least one)

| Variable | Description |
|:---|:---|
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams incoming webhook URL |
| `PAGERDUTY_ROUTING_KEY` | PagerDuty Events API v2 routing key |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_TO` | SMTP settings for email alerts and the digest. `EMAIL_PORT` defaults to `587` |
| `EMAIL_FROM` | Sender address. Defaults to `EMAIL_USER` |

### PPDM poller (SLA and storage checks)

The poller runs only when `PPDM_HOST`, `PPDM_USER` and `PPDM_PASS` are all set. Each run checks every asset and storage system, across all pages of results.

| Variable | Description | Default |
|:---|:---|:---|
| `PPDM_HOST` | PPDM hostname or IP | — |
| `PPDM_USER` / `PPDM_PASS` | PPDM credentials | — |
| `PPDM_PORT` | PPDM HTTPS port | `8443` |
| `SLA_POLL_INTERVAL_MINS` | Minutes between checks. The first check runs at startup | `60` |
| `SLA_WINDOW_HOURS` | An asset is in breach if its last backup is older than this, or it has never been backed up | `24` |
| `ALERT_SLA_BREACH` | Set to `false` to turn the SLA check off | `true` |
| `ALERT_STORAGE_PCT` | Warn when a storage system is more than this percent full. `off` turns the storage check off | `85` |

### Daily digest

| Variable | Description | Default |
|:---|:---|:---|
| `DIGEST_HOUR` | UTC hour to email the digest. Requires the SMTP settings above | `8` |

---

## Use with Claude Code (MCP)

The package isn't published to npm, so register your local build:

```bash
claude mcp add ppdm-alert-bot -- node /path/to/ppdm-alert-bot/dist/index.js
```

| Tool | What it does |
|:---|:---|
| `send_test_alert` | Sends a test alert of a chosen severity to every configured destination |
| `get_alert_config` | Shows every setting: port, webhook secret, each destination, the PPDM connection and which checks are on |
| `classify_event` | Classifies a raw PPDM or NetWorker payload and shows the alert it would produce, without sending it |
| `check_sla_now` | Runs an SLA check against PPDM right now (optionally with a different window), sends a WARNING per breached asset, and lists them |

When Claude Code starts the MCP server, the same process also opens the webhook port and starts the SLA poller and digest. Don't register it in Claude Code on a machine that's already running the bot as a service, or both will compete for the port.

---

## Known limitations

- **TLS verification is disabled** for the PPDM connection, because PPDM servers commonly use self-signed certificates. Run the bot on a trusted internal network.
- **Repeat alerts.** A breached asset or a full storage system is reported again on every poll until it's resolved.
- **Storage fields.** Storage usage is read from `usedPercentage`, or computed from `usedCapacity` / `totalCapacity` (the same mapping ppdm-capacity-planner uses).

---

## Development

```bash
npm run dev      # run from source with tsx
npm run build    # compile TypeScript to dist/
npm test         # run the tests (no network access needed)
```

The source is in `src/`: `index.ts` (webhook server and MCP tools), `classifier.ts` (severity rules), `notifier.ts` (destinations), `sla-poller.ts` and `digest-scheduler.ts`.

See [CHANGELOG.md](CHANGELOG.md) for release history.
