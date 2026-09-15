# Ship Gate

> No repo is "done" until every applicable line is checked.
> Copy this into your repo root. Check items off per-release.

**Tags:** `[all]` every repo · `[npm]` `[pypi]` `[vsix]` `[desktop]` `[container]` published artifacts · `[mcp]` MCP servers · `[cli]` CLI tools

**Repo:** mcp-tool-shop-org/ai-playtest · `@mcptoolshop/ai-playtest` · private 0.1.0 · 2026-09-15

---

## A. Security Baseline

- [x] `[all]` SECURITY.md exists (report email, supported versions, response timeline) — executed by `npx @mcptoolshop/shipcheck security-docs` (A1: present + reporting contact, not an empty stub) (2026-09-15)
- [x] `[all]` README includes threat model paragraph (data touched, data NOT touched, permissions required) — executed by `npx @mcptoolshop/shipcheck security-docs` (A2: trust/threat-model section present + non-empty; *quality* is not machine-checkable) (2026-09-15)
- [x] `[all]` No secrets, tokens, or credentials in source or diagnostics output — `shipcheck secrets` skips while `private: true` (no publishable tarball); identity-scan CLEAN; CI blocks `npm audit --omit=dev` (2026-09-15)
- [x] `[all]` No telemetry by default — stated in README Trust model + SECURITY.md (2026-09-15)

### Default safety posture

- [ ] `[cli|mcp|desktop]` SKIP: no kill/delete/restart surface; the dangerous action is `game.command` spawn, documented as executable-equivalent rather than gated by `--allow-*`
- [x] `[cli|mcp|desktop]` File operations constrained to known directories — writes only under `runsDir` (2026-09-15)
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[mcp]` SKIP: not an MCP server

## B. Error Handling

- [x] `[all]` Errors follow the Structured Error Shape: `code`, `message`, `hint`, `cause?`, `retryable?` — `ConfigError`/`OpenRouterError`/`ActionError`/`ReportError` carry `code` + `hint`; CLI prints `error:` / `hint:` (2026-09-15)
- [x] `[cli]` Exit codes documented and implemented: 0 ok · 1 usage · 2 config/report · 3 provider · 4 run error (richer than the 0–3 template; 1 is user error, 2–4 are distinct runtime classes) (2026-09-15)
- [x] `[cli]` No raw stack traces without `--debug` — stacks only under `DEBUG` / `AI_PLAYTEST_DEBUG` (2026-09-15)
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[desktop]` SKIP: not a desktop app
- [ ] `[vscode]` SKIP: not a VS Code extension

## C. Operator Docs

- [x] `[all]` README is current: what it does, install, usage, supported platforms + runtime versions (2026-09-15)
- [x] `[all]` CHANGELOG.md (Keep a Changelog format) (2026-09-15)
- [x] `[all]` LICENSE file present and repo states support status (MIT) (2026-09-15)
- [x] `[cli]` `--help` output accurate for all commands and flags (2026-09-15)
- [ ] `[cli|mcp|desktop]` SKIP: not a daemon; no silent/normal/verbose ladder. Secrets are not logged. Stacks gated on DEBUG.
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[complex]` SKIP: not a background daemon; handbook is Starlight under `site/` (Phase 10), not HANDBOOK.md ops runbook

## D. Shipping Hygiene

- [x] `[all]` `verify` script exists (typecheck + tests; emit/pack in CI and `prepublishOnly`) (2026-09-15)
- [ ] `[all]` SKIP: no `v*.*.*` release tag yet (package is private 0.1.0; Gate J would compare against swarm-save tags which it already filters as non-semver)
- [x] `[all]` Dependency scanning runs in CI — blocking `npm audit --omit=dev --audit-level=high` (2026-09-15)
- [x] `[all]` Consumer-surface audit is clean (`--omit=dev`). Dev-surface vitest/esbuild HIGH is advisory in CI (`continue-on-error`) and does not ship. Dependabot *alerts* vs auto-PR: org rule forbids the auto-PR bot (CI minutes); alerts are a separate GitHub switch, not a workflow file. (2026-09-15)
- [ ] `[all]` SKIP: automated dependency-update bot (Dependabot PRs) is org-forbidden unless requested — CI-minute bound. Outcome scanning is the D3/deps line above.
- [ ] `[npm]` SKIP: package is `"private": true`; no Trusted Publisher / `release.yml` until the Director flips private and configures npmjs.com (handoff)
- [x] `[npm]` Pack shape gated in CI (`npm pack --dry-run` must include LICENSE + CHANGELOG.md). `shipcheck pack` skips while private. (2026-09-15)
- [x] `[npm]` `engines.node` set (`>=20`) (2026-09-15)
- [x] `[npm]` Lockfile committed (`package-lock.json`) (2026-09-15)
- [ ] `[vsix]` SKIP: not a VS Code extension
- [ ] `[desktop]` SKIP: not a desktop app

## E. Identity (soft gate — does not block ship)

- [x] `[all]` Logo in README header (2026-09-15)
- [x] `[all]` Translations (polyglot-mcp, 8 languages) — ja/zh/es/fr/hi/it/pt-BR via TranslateGemma 27B (2026-09-15)
- [x] `[org]` Landing page (@mcptoolshop/site-theme) — `site/` + handbook, Pages workflow (2026-09-15)
- [x] `[all]` GitHub repo metadata: description, homepage, topics (2026-09-15)

---

## Gate Rules

**Hard gate (A–D):** Must pass before any version is tagged or published.
If a section doesn't apply, mark `SKIP:` with justification — don't leave it unchecked.

**Soft gate (E):** Should be done. Product ships without it, but isn't "whole."
