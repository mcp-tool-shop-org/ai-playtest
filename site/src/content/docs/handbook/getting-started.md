---
title: Getting started
description: Clone, check a config, run a seat, rebuild the report.
sidebar:
  order: 1
---

The GitHub repo is public. There is no npm tarball yet.

```bash
git clone https://github.com/mcp-tool-shop-org/ai-playtest
cd ai-playtest
npm ci
npm run verify    # typecheck + 182 tests
npm run build
```

Node `>=20`. You need `OPENROUTER_API_KEY` for `run`. You do **not** need it for `check`.

## Check the JSON first

```bash
node dist/cli.js check path/to/game.playtest.json
```

Exits **2** on `ConfigError` (unknown keys, bad `schemaVersion`, two seats from one family, …). Prints `error:` and `hint:`. No network.

## Run

```bash
export OPENROUTER_API_KEY=...
node dist/cli.js run path/to/game.playtest.json --label smoke --turns 8
node dist/cli.js run path/to/game.playtest.json --label smoke --seats mistral
node dist/cli.js run path/to/game.playtest.json --label compare --runs 3
node dist/cli.js run path/to/game.playtest.json --label rpc --serial
```

`--seats` lists **config seat ids**, not families. `--runs 3` is descriptive: n=3 cannot reach p<0.05 (`2/2^n` = 0.25). `--serial` runs seats one after another. On the **rpc** driver that reuses one TCP client and calls `reset()` between seats.

Artifacts:

```
<runsDir>/<label>/<seat>/transcript.txt
<runsDir>/<label>/<seat>/critique.json
<runsDir>/<label>/<seat>/meta.json          # schemaVersion + toolVersion
<runsDir>/<label>/REPORT.md
<runsDir>/<label>/REPORT.json               # kind: single-run-report
```

Deleting `<runsDir>/<label>` is the complete undo of the runner. The game's own side effects are not.

## Rebuild the page

```bash
node dist/cli.js report path/to/game.playtest.json --label smoke
```

Rewrites `REPORT.md` and `REPORT.json` from the seat directories. Refuses if a sidecar on disk was written for a **newer** `reportFormat` than this tool emits.

## Exit codes

| code | meaning |
|---|---|
| 0 | ok |
| 1 | usage |
| 2 | config / report |
| 3 | provider (missing key, model has no endpoints) |
| 4 | run error (every seat ended in error, or no seat produced a verdict) |
