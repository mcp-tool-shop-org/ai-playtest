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

### 2. The game process inherits the runner's environment

The child is spawned with the runner's environment plus whatever `game.env`
resolves to. That means a program under test can read every variable the runner
can see, **including `OPENROUTER_API_KEY`**.

If the program under test is not fully trusted, run it with a scoped key, or run
the playtest in a container or VM. A `$NAME` value in `game.env` selects a
variable to pass *explicitly*; it does not withhold the rest.

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
- Never writes the API key to disk. It is read from `OPENROUTER_API_KEY` and
  held in memory. Note that it *is* passed to the child process (see 2).
