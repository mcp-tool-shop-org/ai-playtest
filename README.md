<p align="center">
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/ai-playtest/readme.png" alt="ai-playtest" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://mcp-tool-shop-org.github.io/ai-playtest/"><img src="https://img.shields.io/badge/Landing_Page-live-brightgreen" alt="Landing Page"></a>
</p>

# ai-playtest

Family-diverse AI playtesting for turn-based games. Model players drive a game —
over a terminal, a pseudo-terminal, or a socket into your engine — a jury of
models from *other* families judges each transcript, and a report aggregates the
verdicts alongside how much of the game each session actually saw.

One playthrough by one person tells you what one person saw. Five families
playing the same forty turns tell you what the world does.

Public on GitHub. Not on npm yet — clone it, or consume by path from a sibling repo.

## Who judges

The first thing to know, because it is the thing most such tools get wrong: **a
seat never scores its own play.** Each transcript is judged by one author-off
seat by default (`panelSize`, raise it to flag disagreement — not to average a
stronger score), and the playing seat's own reading is kept as *testimony* —
where it was confused, what it tried — never as the score.

That distinction is load-bearing. Most measured self-preference in LLM judges
turns out to be competence rather than narcissism (only ~10.4% exceeds a
capability-matched control across 37,448 pairs — [Roytburg et al.
2026](https://arxiv.org/html/2601.22548)), **but the residual concentrates in
subjective domains and vanishes in verifiable ones** — and "did the world feel
alive" is as subjective as a criterion gets. Meanwhile self-critique actively
lowers accuracy where an external verifier raises it: Game-of-24 goes 5% → 3%
self-critiqued and → 38% with a sound verifier ([Stechly et al.
2024](https://arxiv.org/abs/2402.08115)).

The default is **one author-off judge**, not a three-judge panel. [Verga et al.
2024](https://arxiv.org/abs/2404.18796) (PoLL) showed a cheap heterogeneous
panel beating GPT-4 on human agreement at 7–8× lower cost (κ 0.763 vs 0.627) —
that is an argument against paying for one *large* judge, not an argument that
three families yield three independent votes. [Kohli
2026](https://arxiv.org/abs/2605.29800) measured nine judges across seven
families at Kish **n_eff = 2.18**; the panel (72.0%) did *not* beat the best
single judge (71.8%); cross-family φ was 0.389 vs same-family 0.437. At
`panelSize: 3` that is **≈1.68 independent votes**. Dawid–Skene does not rescue
it (≤11% of the Condorcet gap). [Kim et al. 2025](https://arxiv.org/abs/2506.07962)
found pairs agree ~60% of the time when both are wrong. So extra jurors are a
disagreement flag, not a stronger score. **Budget moved from judges to runs.**
`--runs 3` is descriptive, not a significance test; the CLI still defaults to
one run so a smoke stays one shot. n=3 can never reach p<0.05 (floor
`2/2^n` = 0.25). See `docs/research-2.md` §A and `docs/research-3.md`.

That does **not** undo taking the author off its own jury, which rests on
Panickssery / Stechly / Huang.

**Disagreement is reported, not averaged away.** A split verdict usually means
the *criterion* is under-specified, not that the game is ambiguous, so splits are
marked with their count and each seat's dispersion is surfaced.

Seat only one family and there is no valid juror. The tool does not quietly hand
the transcript back to its author — it forms no jury, and the report says the
verdict is self-judged and why that is weak. Config validation still refuses to
seat two players from one family: a second family is what makes an author-off
jury possible ([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)).

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
4. **Act.** When the observation carries `actions`, the cleaned reply maps onto
   `choose` / `key` / `line`. A closed-set miss is a harness event — the runner
   does not spend a game turn on it. Setup and quit stay `kind:line`.
5. **Quit.** After `turns` inputs the runner sends `quitInputs` (e.g. `save`,
   `quit`). Those are the *runner's* inputs: they are excluded from the turn
   count and from the evidence, while the terminal screens they produce are kept
   — a crash or a save recap is evidence.
6. **The jury** — one author-off seat by default, temperature 0 — judges the
   transcript against `criteria[]`. Extra jurors (if `panelSize` > 1) flag
   disagreement; they are not averaged into a stronger score. The playing
   seat's own reading is testimony.
7. **Deterministic checks** run on the turn records: absorbing-SCC (Tarjan, never
   labelled a trap), ignored-input attribution, optional parser/victory/death
   regexes, no-progress windows, entity-appearance leads, and (when `state` is
   an object) HP/inventory invariants.
8. **The report** aggregates: criteria by family with juror splits marked,
   coverage as a sampling qualifier, the verifier block, and every dead spot
   and confusion named — jury findings first, author testimony kept. Glyphs
   (`!`, `H(a)`, `repeat`, `loop`) are legend'd on the page.

Artifacts per seat under `<runsDir>/<label>/<seat>/`: `transcript.txt`,
`critique.json`, `meta.json` (pins `schemaVersion` + `toolVersion`),
`stderr.txt` (when the game wrote any). `REPORT.md` and `REPORT.json`
(`kind: "single-run-report"`) at the label root.

## Usage

```bash
export OPENROUTER_API_KEY=...
npm run build
node dist/cli.js run path/to/game.playtest.json --label phase9
node dist/cli.js run path/to/game.playtest.json --label smoke --seats mistral --turns 8
node dist/cli.js run path/to/game.playtest.json --label compare --runs 3   # descriptive; cannot reach p<0.05
node dist/cli.js run path/to/game.playtest.json --label rpc --serial       # one game, several seats; needed for RPC until you multiplex
node dist/cli.js report path/to/game.playtest.json --label phase9   # rebuild REPORT.md + REPORT.json from disk
```

`--serial` runs seats one after another. On the RPC driver it reuses one TCP
client and calls `reset()` between seats. Without `--serial`, each RPC seat
is its own process — they will contend if they share one listening game.

Exit codes: 0 ok · 1 usage · 2 config · 3 provider (key missing, model has no
endpoints) · 4 run error (every seat ended in error, or no seat produced a
verdict). Errors print `error:` and `hint:`.

## Config reference

| key | meaning |
|---|---|
| `name` | playtest name (report title) |
| `driver` | `{"kind":"stdio"}` (default), `{"kind":"pty","cols":100,"rows":30,"readySentinel":"..."}`, or `{"kind":"rpc","port":7777,"host":"127.0.0.1"}` |
| `game.command`, `game.args`, `game.cwd` | how to spawn the game; `cwd` resolves against the config file. Not needed for the `rpc` driver, which attaches to a running game |
| `game.env` | extra env for the game; a value `$NAME` reads the runner's env |
| `game.inheritEnv` | pass the runner's whole environment to the game. **Off by default** — see below |
| `game.promptPatterns` | regexes meaning "waiting for a line", tested against the stripped tail (`stdio`) or the rendered cursor line (`pty`) |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | the waiting rule (defaults 800 / 6000 / 180000 ms) |
| `game.quitInputs` | lines sent after the last turn (default `["quit"]`) |
| `seats[]` | `{ id, family, model }` — OpenRouter slugs; one seat per family |
| `panelSize` | author-off jurors per transcript (default **1**; raise to flag disagreement, not to average a stronger score) |
| `verifiers` | optional regex lists (`unparsed`, `refused`, `victory`, `death`; empty = do not guess). Occupancy: `absorbingMinTurns` (default 4), `noProgressWindow` (default 5), `noOpVerbs` |
| `setup[]` | `{ match, answer }` scripted answers for setup prompts |
| `turns` | play inputs per seat (setup answers and quit inputs do not count; default 40) |
| `persona` | the player brief |
| `criteria[]` | `{ id, check }` the game's own alive criteria |
| `screenChars` | characters of screen kept per turn (default 6000) |
| `playerMemoryTurns` | recent turns the player sees (default 8) |
| `playerTemperature` | player sampling temperature (default 0.7); the critic is always 0 |
| `runsDir` | where runs are written (default `runs`, resolved against the config file) |

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

See [SECURITY.md](SECURITY.md) for the full write-up.

## Trust model

**Data touched:** the playtest JSON, whatever `game.command` / the RPC
bridge prints, OpenRouter chat completions (player + jury), and files the
runner writes under `runsDir` (`transcript.txt`, `critique.json`,
`meta.json`, `REPORT.md`, `REPORT.json`).

**Data not touched:** the runner sends no telemetry and collects no
analytics. The game process does not receive `OPENROUTER_API_KEY` unless
you set `game.inheritEnv: true`. Nothing is written outside `runsDir`.

**Permissions:** `game.command` is `child_process.spawn` — a playtest
config is executable-equivalent. Review it as you would a shell script.
Outbound HTTPS is only the configured OpenRouter base URL. There is no
sandbox.

## Telemetry

None. No analytics, no crash reporter, no phone-home. The only network
call is the one you configured for the models.

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
- **EXTERNAL_VERIFIER — 3.** Each transcript is judged by a family that did not
  produce it (default one author-off seat; raise `panelSize` to flag
  disagreement), with disagreement reported. **This scored 3 while the
  code did the opposite** until the 2026-09-14 swarm — the critic was the same
  model that played. The claim now matches the implementation, and `pickJurors`
  returns an empty jury rather than ever falling back to the author.

## Development

```bash
npm install
npm run verify      # typecheck (src AND tests) + vitest
npm run coverage    # vitest --coverage
```

182 tests. `tsconfig.test.json` exists because the build config excludes test
files, which meant no test file was type-checked by anything — it caught real
type errors on its first run.

---

Built by [MCP Tool Shop](https://mcp-tool-shop.github.io/).
