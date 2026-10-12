# Changelog

## [Unreleased]
### Security
- `nodemailer` 6 → 10 and `npm audit fix` for `axios`, `hono`, `@hono/node-server`, `fast-uri`, `ip-address` and `qs`
- `@modelcontextprotocol/sdk` 1.29.0 → 1.32.1: the OAuth client could send credentials to an authorization server chosen by the MCP server (GHSA-6qxp-vccf-f47h)
- `proxy-addr` 2.0.7 → 2.0.8: IP spoofing via an IPv4-mapped IPv6 trust subnet (GHSA-jqcg-44mw-7w3h, critical)
- `npm audit` reports 0 vulnerabilities

### Changed
- Requires Node.js 20+ (`engines`), as `nodemailer` 10 does; CI runs on Node 22 and 24
- Added MIT `LICENSE` file (`package.json` already declared MIT)
- Added `README.md` and this changelog

## [1.2.0] — 2026-07-14
### Added
- **PagerDuty** — CRITICAL alerts are sent to PagerDuty via the Events API v2 (`PAGERDUTY_ROUTING_KEY`)
- **Email alerts** — CRITICAL and WARNING alerts are emailed over SMTP (`EMAIL_*` settings)
- **Daily digest** — a summary of the last 24 hours of alerts is emailed at `DIGEST_HOUR` UTC
- CI workflow: type check and build on every push and pull request

## [1.1.0] — 2026-07-01
### Added
- **SLA poller** — checks PPDM at startup and every `SLA_POLL_INTERVAL_MINS` (default 60) and raises a WARNING for each asset without a backup inside `SLA_WINDOW_HOURS` (default 24)
- `check_sla_now` MCP tool (4 tools in total). Note: it does not yet run a check; see the README's Known issues

## [1.0.0] — 2026-06-26
### Added
- HTTP webhook receiver (default port 4000) for PPDM job events and NetWorker save set events, with optional `X-Webhook-Secret` authentication
- Severity classification: CRITICAL, WARNING or INFO
- Slack and Microsoft Teams destinations
- MCP server with 3 tools: `send_test_alert`, `get_alert_config`, `classify_event`
