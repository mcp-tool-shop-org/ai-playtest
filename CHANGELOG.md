# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `LICENSE` (MIT). `package.json` had declared MIT since the first commit with no
  license file present, which left the grant ambiguous for anyone receiving the
  code.
- `SECURITY.md`, including the threat model the README did not carry: a playtest
  config is executable-equivalent, the game process inherits the runner's
  environment (API key included), and game output is untrusted input to a model.
- This changelog.

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
