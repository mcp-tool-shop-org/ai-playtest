# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Persona profiles.** `run --profile <name> [--personas a,b]`, or config
  `personas`, plays a set of play styles chosen to answer one question:
  - `scientific`: can these readings be trusted? (replicate, novice, briefed,
    systematic)
  - `bughunter`: what is broken? (cartographer, closer, boundary-pusher,
    continuity-auditor)
  - `player`: who gets what out of it? (runner, reader, completionist, grinder,
    quitter, tinkerer)
  - `gaming`: does it meet genre habits? (genre-veteran, speedrunner,
    theorycrafter, returning-player)

  How it runs:
  - Each persona plays as `<label>--<persona>` beside a `control` that plays the
    config's own persona.
  - Each persona has one target signal from the turn log, such as the share of
    talk and examine inputs, places seen, or inputs the game refused.
  - A persona counts as distinct only if its signal beats control by the noise
    floor and leads the profile. `replicate` measures the floor.

  What it writes:
  - `<label>/PERSONAS.md` / `.json` with the verdicts, every signal, and what
    the game refused by kind of input.
  - `report` rebuilds it from the saved `profile.json`.

  Options: `custom` profiles, extra personas, game-specific action tags, and a
  `briefing` for the briefed persona.

  Scripted bots for every persona, played on the full Harrow Gate town in
  mcp-arcade-cabinets, then shaped the separation rules:
  - **`turnsToFinish`.** The runner, speedrunner and briefed now target this
    signal. It counts turns, except that a run the player quit has none. On
    `turnsPlayed`, the quitter beat the runner by giving up first.
  - **Ties pass the lead check.** "No other persona goes further" now means
    strictly further, so a briefed player and a novice who both make no mistakes
    both count.
  - **The tinkerer targets `share:use`.** That covers give, use, combine and put.
    On `offPath`, every style unlike control scored high, and grinder and
    completionist beat the tinkerer on its own signal.
  - **`spar` counts as a fight input.**
  - **A bare `look` that reprints the screen is a `redisplay`, not an ignored
    input.** The ignored-input check, `rejectedRate`, `diff` and calibration
    grading now read it through one `isIgnored`. The false positive had put the
    novice at 6% refused inputs for typing `look`.
- **`transcriptTurns`** reads a transcript's turn numbers and reasons.
  `transcriptInputs` now returns only the inputs the player chose; it used to
  count setup answers and the runner's own quit sequence. `diff` repros keep
  setup answers, which the game needs, and drop the runner's quit inputs.

- **`diff`, a regression gate between two runs.**
  `ai-playtest diff <config> --base <label> --head <label>` compares the two and
  lists what got worse:
  - a criterion the jury stopped passing (by majority of seats)
  - a world no longer alive
  - a new soft-lock lead
  - ignored input up by 25 points or more
  - more seats ending in error

  Each finding has a stable id, both vote counts, and the turn and inputs in the
  head transcripts that show it. A probability judge's P(met) on the head run is
  attached as a second opinion. `diff` writes `DIFF-<base>.md` / `.json` into the
  head run and exits **5** while any finding is open. `--accept <file>` takes
  `{"accepted":[{"id","note","head"?}]}`. A note is required, accepted findings stay
  in the report, and stale acceptances are listed.

  On the Harrow Gate builds, the lamp-less build produced exactly one finding,
  `criterion-lost:spends-resource`.
- **Probability judges (`scorers`).** A second opinion beside the jury: each
  criterion scored as P(met), shown per criterion and seat in a new report section
  with an uncertain band (`?`, default 0.35–0.65) and a `⚠` where the probability
  is confidently on the other side of the jury's verdict. Scores land in each
  seat's `meta.json` and REPORT.json, so `report` rebuilds keep them. A scorer
  failure is recorded on the seat and never fails it.
- **`{ "kind": "jev" }`**, the first scorer: TypeSafe's decision model
  (`typesafe/jev-1.13`) on OpenRouter's Decisions API. Every criterion goes in one
  request, so the transcript is sent once (about $0.0001 per seat). The transcript
  is fitted to a 26,000-token state by trimming the middle and keeping both ends.
  On 14 transcripts with a known answer it scored an observable criterion 8 of 8
  with wide margins, where the run's own LLM judges scored 6 of 8
  (`docs/research-4.md`).
- **`decisions.ts`**, a general client for the Decisions API: noul, choice and
  score questions, answers validated against the question (the API is alpha), and
  cost reported. Future decision-model features build on it.
- **`ai-playtest score <config> --label <run>`** re-runs the configured scorers
  over a finished run's saved transcripts, against the config's current criteria,
  without replaying the game. It rewrites each seat's scores and the report.
- **Compound-criterion lint.** `check`, `run` and `score` warn about criteria that
  probably bundle two claims ("so", "because", "therefore", "but", a semicolon, more
  than one sentence). Every judge tested passed such a criterion on its easier half.
- **`docs/research-4.md`**: the judge check with its answer key, research on
  criteria and calibration, and the search for a test bed with known answers
  (none exists for the variables ai-playtest judges).
- **Harrow Gate, the calibration game (`calibration/`).** A deterministic text
  adventure with eight playtest variables as switches: the world moves on its
  own, who refuses at the gate (character, system, nobody), whether the prompt
  lists what you can type, whether the game reacts, whether a choice spends a
  visible resource, whether a goal is stated, whether places change on a return
  visit, and whether a trapdoor soft-locks the player. Eleven builds: healthy, one
  mutant per switch (two for refusal), and `bleak`, with every switch flipped
  except `reacts`, which would hide the rest. The game writes a per-turn truth log on
  stderr, which the stdio driver keeps from every model, so the answer key is
  exact per transcript.
- **`src/calibration.ts`**: game-agnostic grading against any `{"cal":1}` truth log
  and a JSON answer key (event happened, never happened, switch set, at least N
  times). Jury accuracy and confusion per criterion, each probability judge's
  accuracy when confident, uncertain count, Brier score and expected calibration
  error, and precision/recall for the soft-lock and ignored-input checks.
  `calibration/calibrate.mjs make | run | grade` drives it. 228 → 242 tests,
  including a real playtest run over the game graded from its saved stderr.

- **Local seats through Ollama.** A seat with `"provider": "ollama"` runs on a
  local Ollama daemon (`OLLAMA_HOST`, default `http://127.0.0.1:11434`). An
  all-local run needs no `OPENROUTER_API_KEY`: the key is demanded only when a
  player, or a juror it will draw, is an OpenRouter seat. Providers mix in one
  config; calls route by model id, so one id cannot be seated on two providers.
- The provider uses Ollama's native `/api/chat`, not `/v1`, so each request sets
  `num_ctx` from its own prompt. A prompt that cannot fit `maxContextTokens`
  (default 32,768) fails before any request, and a reply whose prompt filled the
  window fails as truncated, rather than a judge silently reading the tail of a
  transcript. `done_reason: "length"` is a truncation error, like OpenRouter's
  `finish_reason: "length"`. `think` starts off.
- **Reasoning models that will not stop reasoning.** Measured on the pod:
  `qwen3-next:80b` ignores `think:false` and reasons inside the reply, and
  `gpt-oss:120b` reasons in the thinking channel, so a 60-token player reply came
  back cut off or empty on every turn. A short reply that hits its budget is now
  retried once with the reasoning moved to its own channel (`think:true`, or
  `"low"` for gpt-oss, which can only be lowered) and 2,048 extra tokens, and the
  model is remembered for the rest of the run. A model that cannot think at all
  reports the original truncation.
- **The context estimate counts non-ASCII glyphs at about a token each.** A
  box-drawn TUI screen (│ ─ █) tokenises far worse than prose: an Escape the
  Valley camp screen measured about 4,600 tokens against a 4,096 window sized at
  three characters a token. ASCII stays at three characters a token. Should a
  prompt still fill the window, the call is retried once at twice the size before
  it fails. The ceiling is 65,536 tokens (it was 32,768, and every judge of a
  30-turn Escape the Valley transcript was refused), overridable with
  `AI_PLAYTEST_OLLAMA_MAX_CTX`. The reasoning allowance is 4,096 tokens; 2,048
  was not enough for qwen3-next.
- Cloud-routed Ollama tags (`:cloud`, `-cloud`) are refused at config time and
  again at call time; they bill an ollama.com account.
- `examples/local-smoke.playtest.json`: three local families against the
  fixture echo game. First live run, `local-01`: 3 seats × 6 turns, each
  transcript judged by a different local family, no API key in the environment.
- `OllamaError` (`E_OLLAMA`) exits 3 like other provider errors, with hints for
  a missing model (`ollama pull <tag>`) and a daemon that is down. 182 → 200 tests.
- **The engine bridge has run against a real engine.** First execution of
  `docs/engine-bridge.md`, 2026-10-02: the Godot 4.7 listing pasted into
  `ai-rpg-stage` as an autoload, driven over `rpc` by six local models on a
  RunPod pod while the sim and stage ran headless on the rig. `hello`, typed
  `choose` actions, `reset` and `quit` all held. What the first wiring found is
  in the doc's new "Learned from the first real wiring" section.
- **Named keys for keyboard-driven TUIs (`driver.keys`, pty only).** A map of
  `{ name: bytes }`, e.g. `{ "enter": "\r", "down": "j", "esc": "\u001b" }`. The
  player is offered the names as a `keys` action space and answers with one; the
  game receives the bytes as a raw keypress with no trailing Enter. Without it a
  pty reply is typed as a line plus Enter, which a cursor-and-Enter game reads
  as keystrokes nobody meant: `look` is l, o, o, k, then Enter. Built for
  Saint's Mile (ratatui), which it now drives cleanly from the title screen into
  the prologue's choices; the first probe also found Saint's Mile cutting off
  every prose line at 100 columns (mcp-tool-shop-org/saints-mile#9). 203 → 206 tests.

### Fixed

- **Ignored-input and parser checks named the wrong input.** A turn record holds
  the screen the player saw and the input typed in answer to it, so the game's
  reply to an input is the *next* record's screen. Both checks judged the record's
  own screen, which pinned each "ignored" or "not understood" verdict on the
  input after the one the game answered. They now judge the reply, and list only
  turns that had an input. The tests had built records the other way round, which
  is why they passed.
- **Calibration graded the ignored-input check as firing on every transcript.**
  The check holds a row for every input, and grading counted any row as a hit.
  It now fires when at least 25% of inputs were ignored
  (`IGNORED_FIRES_AT`).
  - Re-derived from cal-01's transcripts, precision went from 9% to 50% and recall
    stayed at 100%.
  - Both remaining false positives are `bleak`, whose replies never change, so a
    screen comparison cannot tell it from a deaf game.
- **A closed-set answer in the harness's own list format was rejected.**
  `describeActions` prints `  id) label`, and models copy it: llama3.2:1b replied
  `weighing-floor)` on all fifteen turns against the Godot stage and took zero
  legal moves; llama3.1:8b echoed whole lines (`long-quay) Walk to The Long Quay`)
  and answered by position (`1`, `2`). A second-chance matcher (`looseChoice`)
  now strips list punctuation and quotes, reads an echoed line by its id, matches
  ids and labels case-insensitively, and takes a bare number as the listed
  position unless some option id is itself numeric. It never fuzzy-matches: an
  answer naming nothing listed stays an `illegal-action`. Same three seats after
  the fix: 15 of 15 legal turns each. The runner maps replies through `toAction`,
  not `actionFromInput`, so the fix had to land in both; fixing only the library
  mapper changed nothing in a live run. 200 → 203 tests.

## [0.1.0] - 2026-09-15

First public GitHub release. Dogfood swarm #2, 2026-09-14. 84 -> 182 tests,
then the Law 8 execute set. First live run against claude-rpg (`proof-01`,
8 turns, mistral). Stage B: 24 HIGH. Stage C: remaining MED/LOW
(humanization — errors that name the cause, CLI help, report honesty).
Feature execute: consume `Observation.actions`, serial RPC `reset()`,
viewport-only PTY grid, report legends, `schemaVersion` on leaving
artefacts, single-run `REPORT.json`.

Not on npm (`package.json` stays `"private": true`).

### Added

- **Typed actions from `Observation.actions`.** Player replies map onto
  `choose` / `key` / `line`. A closed-set miss is a harness event
  (`illegal-action`); the runner does not step. `describeActions()` is appended
  to the player prompt.
- **Serial RPC reuses one driver.** `--serial` on `driver.kind === "rpc"`
  starts once, calls `reset()` between seats, and stops once. A missing or
  throwing `reset` fails that next seat with `E_RESET` (no silent second
  client). Parallel RPC stays one process per seat.
- **PTY viewport grid.** `grid.lines` is `viewportY .. viewportY+rows-1`, not
  the scrollback buffer. Prompt matching uses `baseY+cursorY`. `kind:key`
  writes without a trailing CR.
- **Single-run `REPORT.json`** sidecar (`kind: "single-run-report"`) next to
  `REPORT.md`. Markdown legends teach `!`, `repeat`, `loop`, and `H(a)` in
  bits. `schemaVersion` + `reportFormat` + `VERSION` are stamped on the
  markdown generator line, both JSON reports, and seat `meta.json`.
- **State-gated invariants.** HP never negative and inventory non-decreasing,
  only when a turn carries a structured `state` object — never inferred from
  prose.
- **Landing page + Starlight handbook** (`site/`, accent cyan). Pages workflow
  path-filtered to `site/**`. Live at the org GitHub Pages URL.
- **README translations** (ja, zh, es, fr, hi, it, pt-BR) via TranslateGemma 27B.
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
  speaks `observe` / `act` / `quit` now fails closed on connect. Serial
  `runAll` now calls `reset()` between RPC seats.
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

### Changed

- **The runner consumes `actions` / `state`.** Illegal-action rejection and
  hp/room hashing are wired; `docs/engine-bridge.md` no longer says they are
  protocol-only.
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
- **Critic token budget raised 1,800 → 6,000.** Nineteen criteria with evidence
  strings no longer fit in 1,800 tokens; one seat's critique was cut mid-array
  and failed to parse twice. Sized for roughly 25 criteria. Retries now carry the
  previous parse error so the second attempt is informed.

[Unreleased]: https://github.com/mcp-tool-shop-org/ai-playtest/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mcp-tool-shop-org/ai-playtest/releases/tag/v0.1.0
