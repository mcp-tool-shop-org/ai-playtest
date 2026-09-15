# Security

## Reporting a vulnerability

Open a private security advisory on the repository
(<https://github.com/mcp-tool-shop-org/ai-playtest/security/advisories/new>), or
email the maintainer listed in `package.json`. Please do not open a public issue
for an unpatched vulnerability. Expect an acknowledgement within a week.

## Threat model

This tool exists to run *someone else's program* and feed its output to a
language model. That shape carries three exposures worth stating plainly, because
two of them are not obvious from the README.

### 1. A playtest config is executable-equivalent

`game.command` and `game.args` are passed to `child_process.spawn`. Anyone who
can write a config file — or edit one you already trust — can run an arbitrary
program as you, with your environment. Treat a `*.playtest.json` exactly as you
would treat a shell script: review it before running it, and do not run one from
an untrusted source.

There is no sandbox. The runner does not inspect, restrict, or contain the
process it starts.

### 2. What environment the game process gets

By default the child receives a small allowlist (`PATH`, `HOME`/`USERPROFILE`,
temp and locale variables, and the Windows system paths) plus whatever
`game.env` resolves to — and nothing else. In particular it does **not** receive
`OPENROUTER_API_KEY`.

This was not always true: the child previously inherited the runner's entire
environment, and the key was observed reaching a game's stdout, from where it
flowed into the player model's context and into the written report. If you have
runs from before that fix, treat the key used for them as exposed.

Setting `game.inheritEnv: true` restores full inheritance. Use it only for a
game you trust as much as the runner itself, and prefer a scoped key if you do.

### 3. Game output is untrusted input to a model

Everything the game prints is inserted into the player model's context, and the
transcript is inserted into the critic's prompt. A program under test can
therefore emit text aimed at the model rather than at a player — instructions,
role claims, or content designed to influence its own evaluation.

This matters more than usual here, because the tool's product is a *verdict*: a
game that can steer its own grade defeats the purpose. Treat critiques of an
untrusted binary as advisory, and read the transcript alongside the verdict.

## What the runner itself does

- Writes only under `runsDir` (`transcript.txt`, `critique.json`, `meta.json`,
  `stderr.txt`, `REPORT.md`). Deleting that directory is the complete undo.
- Makes outbound HTTPS requests only to the configured OpenRouter base URL.
- Sends no telemetry and collects no analytics.
- Never writes the API key to disk, and does not pass it to the game process
  unless `game.inheritEnv` is set. It is read from `OPENROUTER_API_KEY` and held
  in memory.

## Known advisories

`npm audit` reports vulnerabilities reachable only through the test runner
(`vitest` → `vite` → `esbuild`). They are **developer-surface only**: this
package ships `dist/` with no runtime dependencies, and the headline advisory
(GHSA-67mh-4wv8-2f99) concerns an esbuild *development server* that never runs
in CI or in a consumer's install.

CI therefore blocks on `npm audit --omit=dev` — what a consumer is actually
exposed to — and prints the full audit as an advisory step rather than hiding
it. The real fix is vitest 4, which cannot currently be installed: npm 10.9.8's
arborist crashes (`Cannot read properties of null (reading 'edgesOut')`) while
resolving vitest 4's peer graph. This will be revisited when npm or vitest
moves.

The optional dependencies (`node-pty`, `@xterm/headless`) are needed only by the
`pty` driver and are not installed into a consumer's runtime path unless that
driver is used.
