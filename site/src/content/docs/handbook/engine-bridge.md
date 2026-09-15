---
title: Engine bridge
description: Newline JSON over TCP so Godot, Unreal, or anything else can describe itself.
sidebar:
  order: 3
---

This is the strongest way to be playtested. A game that describes itself does not make the harness guess when a turn began, does not need a regex to find its prompt, and can say exactly which actions are legal.

The live protocol and a paste-and-go Godot 4 autoload live in the repo at [`docs/engine-bridge.md`](https://github.com/mcp-tool-shop-org/ai-playtest/blob/main/docs/engine-bridge.md). This page is the operator summary.

## What the runner speaks

Required:

1. `hello {protocol:1}` on connect — fail-closed if missing or not protocol 1
2. `observe` on start (and after `reset`)
3. `act` with a typed action (`choose` / `key` / `line` / `call`) on player turns
4. `act` with `{kind:"line", line}` for scripted setup and quit
5. `quit` on stop

`done: true` maps to observation `reason: "exit"` so the seat loop stops. Protocol `win` / `lose` / `stuck` land on `endCause`, not `ReadyReason`.

Serial `--serial`: `reset()` between seats. Missing or throwing reset is `E_RESET` — not a silent second TCP client.

## What the runner consumes

From each observation:

- **`actions`** — listed in the player prompt. A closed-set miss is `illegal-action`.
- **`state`** — hashed for coverage and absorbing-SCC when it is an object. Cited as a clipped `[state]` line in the critic transcript. HP/inventory invariants fire only when `state` is present. The runner does **not** invent hp from prose.

## Result object

| field | required | meaning |
|---|---|---|
| `text` | strongly preferred | What the player sees |
| `state` | | Structured state. Serialised as text if `text` is absent |
| `actions` | | `free-text` / `keys` / `choice` / `schema` |
| `done` | | session over |
| `reason` | | `win` / `lose` / `quit` / `stuck` / `timeout` → `endCause` |
| `image` | | `{mime, base64}` attachment only |

Unsolicited `{"method":"log",...}` lines land in diagnostics and are never shown to the player model.
