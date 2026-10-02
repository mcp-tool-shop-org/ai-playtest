# Calibration: Harrow Gate

A playtester is only worth what its judgments are worth, and those can't be
checked against a real game, where nobody knows the right answer in advance.
This folder holds a game where the right answer is known, so ai-playtest itself
can be scored.

We looked for an existing one first. TextWorld, Jericho, TALES, ScienceWorld,
MiniHack and GBQA were all considered. None of them lets the variables
ai-playtest judges be set on purpose: whether the world moves on its own, who
delivers a refusal, whether the prompt says what you can type, whether choices
cost anything, whether there is a dead end ([`docs/research-4.md`](../docs/research-4.md)).
So we made one.

## The game

**Harrow Gate** is a small text adventure: a walled town, a seal in a dark
archive, a warden at the gate, and a bell that tolls toward dusk. Every playtest
variable is a switch:

| switch | healthy | flipped |
|---|---|---|
| `worldMoves` | a bell tolls on its own and the market closes with the hour | nothing happens unless you act |
| `refusal` | Warden Sela refuses you in her own words | `system`: `[ACCESS DENIED] gate.west requires item:seal`; `none`: the gate is open |
| `prompt` | exits and commands listed before every prompt | a lone `>` |
| `reacts` | the game answers what you typed | every input gets the same answer |
| `choiceCost` | the archive is dark, and the lamp spends visible oil | the archive is lit, nothing to spend |
| `goal` | the intro says what to do | it doesn't |
| `descriptions` | a place reads differently when you come back | it never changes |
| `deadEnd` | the cellar has stairs | the trapdoor locks you in |

[`variants.json`](variants.json) has eleven builds: `baseline` (healthy
everywhere), one mutant per switch, and `bleak`, with every switch flipped. Each
mutant changes one thing, so a judge's miss points at one variable.

The game is deterministic: no randomness and no clock, so the same inputs always
give the same game.

## The answer key comes from the game

Each turn the game writes one JSON line to **stderr**: where the player is and
what happened (`tick`, `refusal:character`, `cost`, `changed-on-return`,
`dead-end`, `stuck`, `ignored`, and so on). The stdio driver keeps stderr away
from every model and saves it as `stderr.txt` beside the transcript.

[`answer-key.json`](answer-key.json) turns that log into a yes or no for each
criterion in [`criteria.json`](criteria.json). The truth is per transcript, not
per build. "Something in the world changes without the player causing it" is
true only if a bell actually tolled while this player was playing, and "the
player is never trapped" is false only if this player actually went down the
trapdoor.

The criteria are written one observable claim each, and they pass the
compound-criterion lint. The grading code is game-agnostic (`src/calibration.ts`):
any game that writes `{"cal":1,...}` lines and ships an answer key can be graded
the same way.

## Running it

```bash
npm run build
node calibration/calibrate.mjs make  --seats calibration/seats.example.json --scorers jev
node calibration/calibrate.mjs run   --label cal-01
node calibration/calibrate.mjs grade --label cal-01
```

- **`make`** writes one playtest config per build into `calibration/configs/`,
  using your seats and the shared criteria.
- **`run`** plays each build in turn.
- **`grade`** writes `calibration/runs/CALIBRATION-cal-01.md` and `.json`, with
  three sections:
  - **The jury:** accuracy and the confusion matrix per criterion, plus every
    cell where it was wrong.
  - **Each probability judge:** how often it was right when it was confident, how
    often it was uncertain, its Brier score, and its expected calibration error.
  - **The deterministic checks:** precision and recall for the soft-lock
    (absorbing-SCC) and ignored-input checks.

`seats.example.json` is the studio default: `gpt-oss:120b` plays and
`gemma4:31b` judges, both local.

## What it measures, and what it doesn't

It measures whether ai-playtest's judges and checks agree with facts the game
can state about itself. It does not measure whether a game is fun, and it can't
tell you whether a model's confusion resembles a person's. Those still need
people.
