---
title: Configuration
description: The playtest JSON — seats, driver, turns, criteria, schemaVersion.
sidebar:
  order: 4
---

A playtest is one JSON file. `check` validates it without a key.

`schemaVersion` is **1**. An unsupported value fails closed with a migrate hint (`panelSize` default is 1, not 3).

## Seats

Each seat has `id`, `family`, `model`. Two seats from one family are refused: a second family is what makes an author-off jury possible. Seat only one family and there is no valid juror — the tool forms no jury rather than self-score.

`panelSize` default **1**. Raise it to flag disagreement, not to average a stronger score.

## Driver

```json
{ "kind": "stdio" }
{ "kind": "pty", "cols": 100, "rows": 30, "readySentinel": "..." }
{ "kind": "rpc", "port": 7777, "host": "127.0.0.1" }
```

## Game (stdio / pty)

`command`, `args`, `cwd` (resolved against the config file), `env` (`$NAME` reads the runner's env), `inheritEnv` (off by default), `promptPatterns`, quiet/timeout knobs, `quitInputs`.

## Play

| key | meaning |
|---|---|
| `turns` | player inputs (setup and quit excluded) |
| `persona` | goals and register — never the mechanics under test |
| `criteria[]` | `{id, check}` the jury answers |
| `setup[]` | `{match, answer}` regex against the prompt tail |
| `playerMemoryTurns` | history the player sees |
| `screenChars` | clip |
| `playerTemperature` | default 0.7 |
| `runsDir` | where artifacts land |

## Verifiers

Optional object. Unknown keys fail closed. Empty regex lists mean those checks stay quiet. Absorbing-SCC occupancy defaults apply even when the object is omitted.

State-gated HP/inventory invariants are not config: they fire when a turn carries an object `state`.
