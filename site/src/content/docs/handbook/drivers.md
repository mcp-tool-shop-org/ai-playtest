---
title: Drivers
description: stdio, pty, and rpc — three ways to produce the same Observation.
sidebar:
  order: 2
---

A playtest needs three things from a game: show me the state, tell me what I may do, tell me when it is my turn. How a game answers differs. The **shape** of the answer does not. That shape is `Observation`. A `Driver` is anything that can produce one.

Set `driver` in the config. Default is `stdio`. Existing configs keep working.

| kind | channel | for |
|---|---|---|
| `stdio` | lines | line-oriented text games |
| `pty` | a rendered terminal **grid** | full-screen TUIs (ratatui, ncurses) |
| `rpc` | structured state over TCP | Godot, Unreal, anything you instrument |

`text` is mandatory. Pixels are an optional attachment. Accessibility-tree observations roughly double screenshot-only success on OSWorld; on BALROG *adding* vision lowered several models. Unscaffolded pixel play sits near zero. So the strongest channel is structured text.

## stdio

Spawn `game.command` + `game.args`. Prompt matching is against the stripped tail. ANSI, OSC, and DCS are stripped; an unterminated OSC does **not** swallow the rest of the screen (BEL/ST required).

## pty

A ConPTY + xterm.js headless grid. `grid.lines` is the **viewport** (`viewportY .. viewportY+rows-1`), not the scrollback buffer. Prompt matching uses `baseY + cursorY`. `kind:key` is written without a trailing CR (a CR would be Enter).

Windows: `node-pty` may print `AttachConsole failed` to the console. That is ConPTY noise, not a failed seat.

## rpc

Newline-delimited JSON over TCP. No `game.command` required — the driver attaches to a running engine. See [Engine bridge](../engine-bridge/).

`--serial` on rpc: one client, `start()` once, `reset()` between seats, `stop()` once. If `reset` is missing or throws, that next seat fails with `E_RESET`. Parallel rpc stays one process per seat (the paste-and-go bridge is single-client).

## Actions on the wire

Player turns map onto `choose` / `key` / `line` from `Observation.actions`. A closed-set miss is recorded as `illegal-action` and is **not** stepped. Scripted setup and quit stay `kind:line`.
