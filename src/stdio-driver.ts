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

export function createStdioDriver(opts: StdioDriverOptions): Driver {
  const game: GameProcess = (opts.spawn ?? spawnGame)(opts.game, opts.env);

  const observe = async (): Promise<Observation> => {
    const screen = await game.nextScreen();
    return {
      text: screen.text,
      actions: opts.actions ?? { kind: 'free-text' },
      reason: screen.reason,
      done: screen.reason === 'exit',
      exitCode: screen.exitCode,
    };
  };

  return {
    modality: 'stdio',
    get diagnostics() { return game.stderr; },
    async start() { return observe(); },
    async step(action: Action) {
      game.send(actionToLine(action));
      return observe();
    },
    async stop() { game.kill(); },
  };
}
