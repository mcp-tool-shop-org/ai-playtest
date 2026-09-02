# ai-playtest

Family-diverse AI playtesting for turn-based text games. Model players from
several families drive a game over stdio, each writes a structured critique
against the game's own "alive" criteria, and a report aggregates the verdicts.
One playthrough by one person tells you what one person saw; five families
playing the same forty turns tell you what the world does.

**Private until it is proper.** Not on npm; consumed by path from sibling repos.

## Why families, not more runs of one model

Every model of one family shares blind spots (Panickssery et al. 2024,
arXiv:2404.13076: a model rates its own family's output higher). A playtest
jury has to sit outside the family that narrates the game and outside the
family that built it. The runner refuses to seat two players from one family.

## How it works

1. **Spawn the game** as a child process (`game.command`, `game.args`, `game.env`).
   The runner never parses the game; it strips ANSI and decides *when the game
   is waiting* — a prompt pattern matched the tail and output went quiet for
   `promptQuietMs`, or nothing matched and `idleQuietMs` of silence passed.
2. **Scripted setup**: prompts that match a `setup[].match` regex are answered
   from the config, without the player and without spending a turn, so every
   family starts from the same character.
3. **The player** (an OpenRouter seat) sees the screen since its last input plus
   its last `playerMemoryTurns` exchanges, briefed by `persona` (goals and
   register — never the mechanics under test), and answers with one line.
   Malformed answers fall back to `look`.
4. After `turns` inputs the runner sends `quitInputs` (e.g. `save`, `quit`),
   recording those screens too (the save recap is evidence).
5. **The critic** — the same seat, temperature 0 — reviews its own transcript
   against `criteria[]` and answers one JSON object: per-criterion met /
   evidence / turn, an alive verdict, highlights, dead spots, confusions.
6. **The report** aggregates every seat: criteria by family, verdict counts,
   every dead spot and confusion named with its seat.

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
endpoints) · 4 run error (every seat failed). Errors print `error:` and `hint:`.

## Config reference

| key | meaning |
|---|---|
| `name` | playtest name (report title) |
| `game.command`, `game.args`, `game.cwd` | how to spawn the game; `cwd` resolves against the config file |
| `game.env` | extra env for the game; a value `$NAME` reads the runner's env (never put secrets in the file) |
| `game.promptPatterns` | regexes meaning "waiting for a line", tested against the stripped stdout tail |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | the waiting rule (see above) |
| `game.quitInputs` | lines sent after the last turn |
| `seats[]` | `{ id, family, model }` — OpenRouter slugs; one seat per family |
| `setup[]` | `{ match, answer }` scripted answers for setup prompts |
| `turns` | play inputs per seat (setup answers do not count) |
| `persona` | the player brief |
| `criteria[]` | `{ id, check }` the game's own alive criteria |
| `screenChars`, `playerMemoryTurns`, `playerTemperature`, `runsDir` | context and output knobs |

A worked config: `claude-rpg/dogfood/playtest/claude-rpg.playtest.json` (the
shipped Claude narrator runs through OpenRouter's Anthropic-compatible
endpoint — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, the SDK appends
`/v1/messages` — with the game's `CLAUDE_RPG_MODEL` override naming an
`anthropic/...` slug).

## Standards compliance (workflow standards, scored 0–3)

- **PIN_PER_STEP — 2.** Every seat pins its model slug; the player and critic
  prompts are code constants; the config is the replayable input. Temperature
  and provider routing are not pinned by OpenRouter, so a replay is
  prompt-identical, not byte-identical. Remediation: record the provider
  OpenRouter chose per call in `meta.json` (owner: coordinator, next slice).
- **ANDON_AUTHORITY — 2.** A seat that stalls (`screenTimeoutMs`), exits early,
  or exhausts retries ends with a recorded reason; the CLI exits 4 only when
  every seat failed, so one dead seat never masquerades as a verdict.
- **NAMED_COMPENSATORS — skip:** the runner performs no irreversible external
  action. The game's own saves land in the game's save directory; deleting a
  run directory is the whole undo.
- **DECOMPOSE_BY_SECRETS — 2.** `openrouter.ts` is the only network seam;
  `stdio-game.ts` the only process seam; the rest is pure and tested against
  a fixture game and a fake client.
- **UNCERTAINTY_GATED_HUMANS — 2.** The report ends in the human's hands: it
  aggregates but never rules. Dead spots and confusions are surfaced with the
  seat that found them so the reader can weigh a lone dissent.
- **EXTERNAL_VERIFIER — 3.** The point of the tool: the critics are seats
  outside the narrating family and outside the building family, one per
  family, refused by config validation otherwise.

## Development

```bash
npm install
npm run verify   # typecheck + vitest (fixture game under test/fixtures)
```
