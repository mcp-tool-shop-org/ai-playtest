---
title: Handbook
description: How to playtest a turn-based game with model players, an author-off jury, and a report that says how much they saw.
sidebar:
  order: 0
---

**ai-playtest** drives a game with model players from several families, judges each transcript with a seat that did *not* play, and writes a report that a human can read without scraping.

It is still **private 0.1.0**. Clone it; do not `npm install @mcptoolshop/ai-playtest` yet.

## What a run is

1. **Observe.** A driver produces an `Observation`: always `text`, optionally a terminal `grid`, structured `state`, an image attachment, and the `actions` that are legal right now.
2. **Setup.** Prompts matching `setup[].match` are answered from the config. No player, no turn spent.
3. **Play.** The player sees the screen plus `playerMemoryTurns` of history, briefed by `persona`. When `actions` is a closed set, a miss is a harness event (`illegal-action`) — the runner does not step.
4. **Quit.** After `turns` inputs the runner sends `quitInputs`. Those are the runner's, not the player's.
5. **Jury.** One author-off seat by default. Extra jurors flag disagreement; they are not a stronger score.
6. **Verifiers.** Transcript-only checks, including absorbing-SCC labelled `kind=review` — never a trap proof.
7. **Report.** `REPORT.md` plus `REPORT.json` (`kind: "single-run-report"`). Glyphs have legends.

## Read next

- [Getting started](../getting-started/) — `check`, `run`, `report`, `--serial`, `--runs`
- [Drivers](../drivers/) — stdio, pty, rpc
- [Engine bridge](../engine-bridge/) — Godot / Unreal newline JSON
- [Configuration](../configuration/) — the JSON
- [Reading a report](../reading-a-report/) — `!`, `H(a)`, thin, splits
- [CLI reference](../reference/)
