# ai-playtest

Family-diverse AI playtesting for turn-based games. Model players drive a game —
over a terminal, a pseudo-terminal, or a socket into your engine — a jury of
models from *other* families judges each transcript, and a report aggregates the
verdicts alongside how much of the game each session actually saw.

One playthrough by one person tells you what one person saw. Five families
playing the same forty turns tell you what the world does.

**Private until it is proper.** Not on npm; consumed by path from sibling repos.

## Who judges

The first thing to know, because it is the thing most such tools get wrong: **a
seat never scores its own play.** Each transcript is judged by up to three seats
from families that did not produce it, and the playing seat's own reading is kept
as *testimony* — where it was confused, what it tried — never as the score.

That distinction is load-bearing. Most measured self-preference in LLM judges
turns out to be competence rather than narcissism (only ~10.4% exceeds a
capability-matched control across 37,448 pairs — [Roytburg et al.
2026](https://arxiv.org/html/2601.22548)), **but the residual concentrates in
subjective domains and vanishes in verifiable ones** — and "did the world feel
alive" is as subjective as a criterion gets. Meanwhile self-critique actively
lowers accuracy where an external verifier raises it: Game-of-24 goes 5% → 3%
self-critiqued and → 38% with a sound verifier ([Stechly et al.
2024](https://arxiv.org/abs/2402.08115)).

A panel rather than a single strong judge, because a panel of cheaper
heterogeneous judges measures closer to humans and costs 7–8× less — κ 0.763 vs
0.627 ([Verga et al. 2024](https://arxiv.org/abs/2404.18796)) — and because
"use multiple evaluators" is the standing remedy for the evaluator effect, where
only 20% of 93 problems were found by every evaluator and 46% by a single one
(Hertzum & Jacobsen 2003).

> **Contested, and worth knowing before you trust the panel size.** [Kohli
> 2026](https://arxiv.org/abs/2605.29800) measured nine judges across seven
> families at a Kish effective sample size of **2.18**, found the panel (72.0%)
> did *not* beat the best single judge (71.8%), and — most relevant here —
> found **cross-family diversity buys almost nothing**: mean pairwise φ of 0.389
> across families vs 0.437 within one. A 3-judge cross-family panel is worth
> roughly **1.68 independent votes**. That does not undo the case for taking the
> author off its own jury, which rests on different evidence entirely. It does
> undercut the idea that *family diversity* purchases independence, and it
> suggests budget is better spent on more RUNS than more judges. Unresolved;
> see `docs/research-2.md`.

**Disagreement is reported, not averaged away.** A split verdict usually means
the *criterion* is under-specified, not that the game is ambiguous, so splits are
marked with their count and each seat's dispersion is surfaced.

Seat only one family and there is no valid juror. The tool does not quietly hand
the transcript back to its author — it forms no jury, and the report says the
verdict is self-judged and why that is weak. Config validation still refuses to
seat two players from one family: family diversity is what makes a jury possible
([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)).

## Drivers — how the game is observed

| driver | channel | for |
|---|---|---|
| `stdio` | lines | line-oriented text games (the default) |
| `pty` | a rendered terminal **grid** | full-screen TUIs (ratatui, ncurses) |
| `rpc` | structured state over TCP | Godot, Unreal, anything you can instrument |

The ordering is by how *structured* the channel is, and that is deliberate rather
than a matter of taste. Accessibility-tree observations roughly double
screenshot-only success on [OSWorld](https://arxiv.org/abs/2404.07972) (12.24% vs
5.26%); on [BALROG](https://arxiv.org/abs/2411.13543) *adding* vision lowered
several models outright (GPT-4o 32.34% → 22.56%); unscaffolded pixel play sits
near zero on [VideoGameBench](https://arxiv.org/abs/2505.18134) (0.48% game
completion); and [Voyager](https://arxiv.org/abs/2305.16291), still the strongest
open-ended game agent, drove a structured API and never saw a pixel.

So a screenshot is an optional *attachment* on an observation, never the only
channel. **If your game can describe itself, it should** — see
[docs/engine-bridge.md](docs/engine-bridge.md) for a paste-and-go Godot 4
autoload where `_observation()` and `_apply()` are the only functions you write,
plus the Unreal routing.

### Why `pty` matters even for text games

Under a pipe, a C program's stdout becomes fully buffered, so "output went quiet
for N ms" can mean *"has not flushed yet"* rather than *"is waiting for you"*. A
PTY restores line buffering and makes the readiness rule sound. On Windows a pipe
captures nothing at all from a game drawing through the Console API.

It also fixes what a redraw looks like. Measured on the test TUI: the grid holds
**115 characters of one current screen**, where the line-append view holds **416
characters** of three stacked redraws with the player's echoed input interleaved
and *three contradictory HP values*. The model has to guess which is live.

`pty` needs the optional `node-pty` and `@xterm/headless`. They install prebuilt
on Windows and macOS; node-pty compiles on Linux. Without them that driver fails
with a coded error naming the install command — nothing else is affected.

## How much each seat actually saw

A model player that does not explore produces a confident report about a game it
barely looked at. Every run therefore carries a coverage block computed from the
turn records alone — no instrumentation, no extra model calls: the novelty curve
and half-life, repeat / loop / self-loop rates, action entropy, and a plain
`thin` / `moderate` / `broad` read with the reasons.

This is worth having because the failure is measured, not theoretical.
Task-oriented LLM agents repeat their previous action **63.4%** of the time with a
16.0% loop rate, against 24.9% / 7.7% for agents *trained* for exploration ([Ye
et al. 2026](https://arxiv.org/html/2605.16143)). Read that as the band agent
repetition actually sits in — not as something a persona string buys, since
merely prompting an agent to explore is worth only **+2.57** average pass@1
([Englander et al. 2026](https://arxiv.org/html/2604.17609)). Low action entropy
also tracks *low* success rather than efficiency, so a tidy transcript with few
distinct inputs is a warning sign, not a good one.

## How to read a verdict

**Rank builds; do not trust absolute scores.** This is the most important caveat
in the tool, and it comes from two independent literatures. LLM judges of
narrative quality reach system-level τ ≈ 0.70 against a human ceiling of 0.73,
but story-level τ of only 0.16–0.25 — barely above BERTScore ([Chhun et al.
2024](https://arxiv.org/abs/2405.13769)). Automated playtesting validates the
same way: AI pass rates track human pass rates at ρ = 0.80 across 95,266 players
([Roohi et al. 2021](https://arxiv.org/abs/2107.12061)), while absolute agent
skill does not transfer at all.

So "build B scored worse than build A on *reacts-to-player*" is a claim this tool
supports. "This game is alive: yes" is not, and the report is written to keep
that distinction visible.

**A known gap, stated plainly:** no study we could find measures agreement
between issues found by agent playtesters and issues found by human playtesters
*for experience quality*. Automated playtesting is validated against difficulty
and competence only. The tool's central premise — that a model's confusions
resemble a player's — is therefore untested in the literature either way. Treat
dead spots and confusions as leads to check, not as findings.

## How it works

1. **Observe.** The driver produces an `Observation`: always `text`, optionally a
   terminal `grid`, structured `state`, an `image` attachment, and the `actions`
   that are legal right now. It also records *how* it knew it was the player's
   turn — a game-emitted sentinel, a terminal ready-signal, a prompt pattern, or
   a quiescence guess — so you can tell knowledge from inference.
2. **Scripted setup.** Prompts matching a `setup[].match` regex are answered from
   the config, without the player and without spending a turn, so every family
   starts from the same character.
3. **The player** sees the screen since its last input plus its last
   `playerMemoryTurns` exchanges, briefed by `persona` (goals and register —
   never the mechanics under test), and answers with one line. Malformed answers
   fall back to `look`.
4. **Quit.** After `turns` inputs the runner sends `quitInputs` (e.g. `save`,
   `quit`). Those are the *runner's* inputs: they are excluded from the turn
   count and from the evidence, while the terminal screens they produce are kept
   — a crash or a save recap is evidence.
5. **The jury** — seats from other families, temperature 0 — judge the transcript
   against `criteria[]` and return per-criterion met / evidence / turn, an alive
   verdict, highlights, dead spots, confusions.
6. **The report** aggregates: criteria by family with agreement marked, coverage
   per seat, and every dead spot and confusion named with the seat that found it.

Artifacts per seat under `<runsDir>/<label>/<seat>/`: `transcript.txt`,
`critique.json`, `meta.json`, `stderr.txt` (when the game wrote any).
`REPORT.md` at the label root.

## Usage

```bash
export OPENROUTER_API_KEY=...
npm run build
node dist/cli.js run path/to/game.playtest.json --label phase9
node dist/cli.js run path/to/game.playtest.json --label smoke --seats mistral --turns 8
node dist/cli.js report path/to/game.playtest.json --label phase9   # rebuild REPORT.md from disk
```

Exit codes: 0 ok · 1 usage · 2 config · 3 provider (key missing, model has no
endpoints) · 4 run error (every seat failed, or no seat produced a verdict).
Errors print `error:` and `hint:`.

## Config reference

| key | meaning |
|---|---|
| `name` | playtest name (report title) |
| `driver` | `{"kind":"stdio"}` (default), `{"kind":"pty","cols":100,"rows":30,"readySentinel":"..."}`, or `{"kind":"rpc","port":7777,"host":"127.0.0.1"}` |
| `game.command`, `game.args`, `game.cwd` | how to spawn the game; `cwd` resolves against the config file. Not needed for the `rpc` driver, which attaches to a running game |
| `game.env` | extra env for the game; a value `$NAME` reads the runner's env |
| `game.inheritEnv` | pass the runner's whole environment to the game. **Off by default** — see below |
| `game.promptPatterns` | regexes meaning "waiting for a line", tested against the stripped tail (`stdio`) or the rendered cursor line (`pty`) |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | the waiting rule |
| `game.quitInputs` | lines sent after the last turn |
| `seats[]` | `{ id, family, model }` — OpenRouter slugs; one seat per family |
| `panelSize` | cross-family jurors per transcript (default 3) |
| `setup[]` | `{ match, answer }` scripted answers for setup prompts |
| `turns` | play inputs per seat (setup answers and quit inputs do not count) |
| `persona` | the player brief |
| `criteria[]` | `{ id, check }` the game's own alive criteria |
| `screenChars`, `playerMemoryTurns`, `playerTemperature`, `runsDir` | context and output knobs |

A worked config: `claude-rpg/dogfood/playtest/claude-rpg.playtest.json` (the
shipped Claude narrator runs through OpenRouter's Anthropic-compatible
endpoint — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, the SDK appends
`/v1/messages` — with the game's `CLAUDE_RPG_MODEL` override naming an
`anthropic/...` slug).

### A note on `game.inheritEnv`

The game process gets a small allowlist plus your `game.env`, and **not**
`OPENROUTER_API_KEY`. This was not always true: the key previously reached the
game and was observed rendered into screen text, from where it flowed into the
player's context and the written report. If you have runs from before that fix,
treat the key used for them as exposed. `inheritEnv: true` restores full
inheritance — use it only for a game you trust as much as the runner itself.

See [SECURITY.md](SECURITY.md) for the threat model: a playtest config is
executable-equivalent, and game output is untrusted input to a model.

## Standards compliance (workflow standards, scored 0–3)

- **PIN_PER_STEP — 2.** Every seat pins its model slug; player and critic prompts
  are code constants; the config is the replayable input. OpenRouter does not pin
  provider routing, so a replay is prompt-identical, not byte-identical.
  *Remediation: record the provider chosen per call in `meta.json`.*
- **ANDON_AUTHORITY — 2.** A seat that stalls (`screenTimeoutMs`), exits early,
  or exhausts retries ends with a recorded reason; a run where no seat produced a
  verdict exits 4 rather than 0, so a silent critique failure cannot read as ok.
- **NAMED_COMPENSATORS — skip:** the runner's only artifact is the run directory;
  deleting it is the whole undo. The *game's* side effects are its own and
  outside the runner's control — which is exactly why a playtest config is
  treated as executable-equivalent.
- **DECOMPOSE_BY_SECRETS — 3.** `driver.ts` is the observation seam,
  `openrouter.ts` the only network seam, `panel.ts` the judging seam; each has
  its own tests and a fake on the other side.
- **UNCERTAINTY_GATED_HUMANS — 3.** The report aggregates but never rules, and it
  states its own uncertainty: split verdicts, thin coverage, a sample-of-one
  warning, and criteria no judge answered are all surfaced rather than smoothed.
- **EXTERNAL_VERIFIER — 3.** Each transcript is judged by families that did not
  produce it, by a panel, with disagreement reported. **This scored 3 while the
  code did the opposite** until the 2026-09-14 swarm — the critic was the same
  model that played. The claim now matches the implementation, and `pickJurors`
  returns an empty jury rather than ever falling back to the author.

## Development

```bash
npm install
npm run verify      # typecheck (src AND tests) + vitest
npm run coverage    # vitest --coverage
```

84 tests. `tsconfig.test.json` exists because the build config excludes test
files, which meant no test file was type-checked by anything — it caught real
type errors on its first run.
