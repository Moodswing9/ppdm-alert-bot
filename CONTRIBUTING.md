# Contributing to ppdm-alert-bot

Thanks for helping out. Bug reports, fixes and new alert destinations are all welcome.

## Reporting a bug

Open an issue using the **Bug report** template. Include your PPDM or NetWorker version and, if relevant, the webhook payload that caused the problem. Remove hostnames, asset names, webhook URLs and secrets before posting.

## Making a change

1. Fork the repo and create a branch from `main`.
2. Install, build and test:
   ```bash
   npm ci
   npm run build
   npm test
   ```
3. Make your change and add tests for it in `test/`. The tests use a fake PPDM client, so they need no network access.
4. Make sure `npx tsc --noEmit`, `npm run build` and `npm test` pass. CI runs all three on Node 22 and 24.
5. Add an entry under a new `[Unreleased]` heading in `CHANGELOG.md`, and update `README.md` if behaviour or settings changed.
6. Open a pull request describing what changed and how you tested it.

## Guidelines

- Log to stderr only. stdout carries the MCP protocol, and a test enforces this.
- Every setting must be documented in `README.md` and `.env.example`, and must actually be read by the code.
- Never log secrets, webhook URLs or credentials.

## Releases

Maintainers bump the version in `package.json` and publish a GitHub release tagged `vX.Y.Z`. The publish workflow runs the tests, checks that the tag matches `package.json`, and releases to npm.
