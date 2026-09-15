---
title: CLI reference
description: run, report, check, flags, exit codes.
sidebar:
  order: 6
---

```
ai-playtest -- family-diverse AI playtesting for text games

Usage:
  ai-playtest run <config.json> [--label <name>] [--seats <id,id>] [--turns <n>] [--runs <n>] [--serial]
  ai-playtest report <config.json> --label <name>
  ai-playtest check <config.json>
  ai-playtest --help | --version
```

`--help` / `-h` works from any position. `--version` prints the package version (`0.1.0`).

| flag | meaning |
|---|---|
| `--label` | run directory name under `runsDir` |
| `--seats` | comma-separated **seat ids** from the config |
| `--turns` | override `turns` |
| `--runs` | N independent runs; aggregate is descriptive at n=3 |
| `--serial` | seats in order; rpc reuses one driver + `reset()` |

Env: `OPENROUTER_API_KEY` (players and critics). The game's env comes from `config.game.env`. `DEBUG` or `AI_PLAYTEST_DEBUG` prints stacks.

## Exit codes

0 ok · 1 usage · 2 config/report · 3 provider · 4 run error.

Errors print `error:` and `hint:`.

## Library

```ts
import { runAll, writeReport, actionFromInput, toAction } from '@mcptoolshop/ai-playtest';
```

Not on npm yet. From a clone, import from `dist/index.js` after `npm run build`.
