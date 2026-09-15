# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Dogfood swarm #2, 2026-09-14. 84 -> 163 tests. First live run against claude-rpg
(`proof-01`, 8 turns, mistral). Stage B: 24 HIGH. Stage C: remaining MED/LOW
(humanization — errors that name the cause, CLI help, report honesty).

### Added

- **README lockup** from `mcp-tool-shop-org/brand` (`logos/ai-playtest/readme.png`).
- **Deterministic transcript verifiers** (`src/verifiers.ts`). Six checks, all
  transcript-only: absorbing-SCC (Tarjan over the observed screen digraph,
  `kind=review`, never a trap proof), ignored-input attribution, parser
  unparsed/refused/accepted with empty defaults, terminal victory/death,
  no-progress windows, entity-appearance leads for the jury. Specified in
  `docs/research-2.md` §D; false-positive modes printed beside every hit.
- **`--runs N`** with a Beta-Binomial posterior `Beta(s+1, n−s+1)`, stability
  labels `STABLE_PASS` / `STABLE_FAIL` / `UNSTABLE`, worst-of-n beside the mean,
  and the copy that n=3 is descriptive (`2/2^n` = 0.25). First n that can
  clear α=0.05 is 6. Do not bootstrap.
- **Jury `n_eff`** on the report: `k / (1+(k−1)·φ̄)`, warn when `n_eff/k < 0.5`.

- **RPC `hello {protocol:1}` is a hard handshake.** A bridge that only
  speaks `observe` / `act` / `quit` now fails closed on connect. `reset()`
  exists on the driver; `runAll` still does not send it between seats.

### Changed

- **`panelSize` default 1**, not 3. Kohli 2026 (Kish n_eff 2.18, panel 72.0% vs
  best single 71.8%, cross-family φ 0.389 vs same-family 0.437) undercuts
  *family diversity buys independence*. Author-off-jury stays (Panickssery /
  Stechly). Extra jurors flag disagreement. Decision written in
  `docs/research-3.md`.
- Coverage "thin" on a short-but-varied session is labelled a **sample-size
  limit**, not "explored thinly / never reached the content" (proof-01).
- Criteria-table agreement uses juror splits on a 1-seat run (proof-01 hid
  1/3 splits behind `no!` and an em-dash).
- Jury dead spots and confusions appear in the report, not only the author's.

- **Three drivers behind one observation seam.** `stdio` (the original),
  `pty` (a rendered terminal grid, for full-screen TUIs), and `rpc` (structured
  state over TCP, for Godot / Unreal / anything instrumented). Selected with
  `driver` in the config; defaults to `stdio`, so existing configs are
  unaffected. `docs/engine-bridge.md` carries a paste-and-go Godot 4 autoload.
- **A cross-family jury.** Each transcript is judged by author-off seats
  (`panelSize`, default 1). Majority verdict, split criteria marked, dispersion
  reported. (Shipped at default 3 in swarm #1; default moved to 1 in swarm #2 —
  see Changed.)
- **Coverage.** Novelty curve and half-life, repeat / loop / self-loop rates,
  action entropy and a thin/moderate/broad read, computed from turn records
  alone.
- `LICENSE` (MIT), `SECURITY.md` with the threat model, CI, `prepublishOnly`,
  `tsconfig.test.json`, and this changelog.

### Fixed

- **Last player input's resulting screen was labelled `quit`.** The quit loop
  consumed it, so the critic never saw the last action's result (proof-01:
  `/director` opened director mode; the recap the jury cited was the save
  screen). Consequence is now recorded first; runner quit inputs stay `quit`.


- **Verdicts could be inverted.** `parseCritique` coerced with `Boolean()`, and
  `Boolean("false") === true`, so a critic answering `"alive": "false"` as a
  string was recorded as alive with every criterion met.
- **The OSC branch of the ANSI regex over-deleted.** It terminated on the next
  BEL anywhere in the buffer, so an ST-terminated OSC plus a later BEL removed
  everything between them — 46 characters of narration in the measured case.
  That regex also stored literal control bytes, so reviewers saw a different
  pattern than the one that ran.
- **`OPENROUTER_API_KEY` reached the game process** and was observed rendered
  into screen text, from there into the player's context and the written report.
  The child now gets an allowlist; `game.inheritEnv` opts back in.
- The critic's evidence included the runner's own quit inputs as player
  decisions and excluded every terminal screen, so crashes and stalls were
  invisible to the verdict.
- The transcript sat last and unframed in the critic's prompt — the most
  instruction-weighted position — so a game could steer its own grade.
- stderr shared a quiet-timer with stdout (3063 ms timeout every turn where
  220 ms prompt was correct); stdout chunks were decoded independently,
  corrupting split multi-byte characters; an unhandled EPIPE on stdin took down
  every parallel seat; a failed spawn reported nothing.
- `finish_reason: 'length'` was returned as success, and `res.text()` sat
  outside the retry loop's try/catch.
- `--label ../../etc` escaped `runsDir`; `--turns abc` played zero turns and
  exited 0; `Promise.all` discarded every sibling when one seat threw; a run
  where every critique failed exited 0; the report read "Alive verdicts: 1 of 1"
  for a two-seat run with one dead seat.

## [0.1.0] - 2026-09-02

First working runner. Private; not published to npm.

### Added

- **stdio game driver** (`stdio-game.ts`) — spawns a game as a child process and
  decides *when the game is waiting for input*: a `promptPatterns` regex matched
  the stripped tail and output went quiet for `promptQuietMs`, or nothing matched
  and `idleQuietMs` of silence passed. The runner never parses the game.
- **OpenRouter seats** (`openrouter.ts`) — one HTTP seam, injectable `fetch`, six
  retries with exponential backoff (126 s total) for bursty upstream rate limits.
- **Model players** (`player.ts`) — a seat sees the screen since its last input
  plus its last `playerMemoryTurns` exchanges, is briefed by `persona` (goals and
  register, never the mechanics under test), and answers with one line.
- **Scripted setup** (`config.ts`, `run.ts`) — prompts matching a `setup[].match`
  regex are answered from the config without spending a turn, so every family
  starts from the same character.
- **Critic** (`critic.ts`) — reviews a transcript against the game's `criteria[]`
  at temperature 0 and returns one JSON object: per-criterion met/evidence/turn,
  an alive verdict, highlights, dead spots, confusions.
- **Report** (`report.ts`) — aggregates every seat: criteria by family, verdict
  counts, and every dead spot and confusion named with the seat that found it.
- **CLI** (`cli.ts`) — `run` and `report` verbs; exit codes 0 ok, 1 usage,
  2 config, 3 provider, 4 run error.
- Config validation refusing two seats from one model family.

### Fixed

- **Critic token budget raised 1,800 → 6,000.** Nineteen criteria with evidence
  strings no longer fit in 1,800 tokens; one seat's critique was cut mid-array
  and failed to parse twice. Sized for roughly 25 criteria. Retries now carry the
  previous parse error so the second attempt is informed.

[Unreleased]: https://github.com/mcp-tool-shop-org/ai-playtest/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mcp-tool-shop-org/ai-playtest/releases/tag/v0.1.0
