// stdio-driver.ts — the original line-oriented driver, behind the Driver seam.
//
// This is the same spawn-and-watch-for-quiet logic the tool has always used; it
// is wrapped rather than rewritten, because it works for the games it was built
// for and the generalisation must not make the text path worse.
//
// Its honest limitations, which the other drivers exist to address: under a pipe
// a C program's stdout is fully buffered, so "output went quiet" can mean "has
// not flushed yet" rather than "is waiting for you"; and a full-screen redraw
// arrives as an append-only log rather than a screen. Use the `pty` driver when
// either matters.

import type { GameConfig } from './config.js';
import { spawnGame, type GameProcess } from './stdio-game.js';
import type { Driver, Observation, Action, ActionSpace } from './driver.js';
import { actionToLine } from './driver.js';

export type StdioDriverOptions = {
  game: GameConfig;
  env: Record<string, string>;
  actions?: ActionSpace;
  /** Injectable for tests. */
  spawn?: typeof spawnGame;
};

export class SpawnFailedError extends Error {
  readonly code = 'E_SPAWN_FAILED';
  constructor(message: string, readonly hint: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SpawnFailedError';
  }
}

export function createStdioDriver(opts: StdioDriverOptions): Driver {
  const game: GameProcess = (opts.spawn ?? spawnGame)(opts.game, opts.env);
  let launched = false;

  const observe = async (): Promise<Observation> => {
    const screen = await game.nextScreen();
    // spawnError is also set on a later stdin EPIPE; only the first screen
    // before a successful launch is "could not start".
    const spawnFailed = !launched && game.spawnError !== null;
    const spawnMsg = spawnFailed && game.spawnError ? game.spawnError.message : undefined;
    if (!spawnFailed) launched = true;
    const text = spawnMsg
      ? `[could not start] ${spawnMsg}${screen.text ? `\n${screen.text}` : ''}`
      : screen.text;
    return {
      text,
      actions: opts.actions ?? { kind: 'free-text' },
      reason: screen.reason,
      endCause: spawnMsg ? 'spawn-failed' : undefined,
      done: screen.reason === 'exit',
      exitCode: screen.exitCode,
      spawnError: spawnMsg,
    };
  };

  return {
    modality: 'stdio',
    get diagnostics() { return game.stderr; },
    async start() {
      const obs = await observe();
      if (obs.spawnError) {
        throw new SpawnFailedError(
          `could not start the game: ${obs.spawnError}`,
          'the command failed to launch (missing binary, bad path, or spawn ENOENT) — this is not a game that exited immediately',
          { cause: game.spawnError },
        );
      }
      return obs;
    },
    async step(action: Action) {
      game.send(actionToLine(action));
      return observe();
    },
    async stop() { game.kill(); },
  };
}
