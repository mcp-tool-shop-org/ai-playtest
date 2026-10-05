// rpc-launch.ts — start the game, then attach the rpc driver to it.
//
// An rpc config with an empty command still attaches to a game that is already
// listening. When `game.command` is set, `run` owns the process: it spawns it,
// reads `PLAYTEST_BRIDGE_PORT=<n>` from its output, and connects there. The
// announced port wins over `driver.port`. A game that never prints the line
// falls back to the configured port, so a fixed listen address still works.
// `stop` kills the child. A connect failure kills it too, so a half-started
// game does not keep the port.

import { spawn, type ChildProcess } from 'node:child_process';
import type { Driver } from './driver.js';
import { createRpcDriver, RpcDriverError } from './rpc-driver.js';
import { buildChildEnv } from './stdio-game.js';

const PORT_LINE = /PLAYTEST_BRIDGE_PORT=(\d+)/;
const STDERR_TAIL = 4_000;

export type RpcLaunchOptions = {
  command: string;
  args: string[];
  cwd?: string;
  /** Config env, already resolved. Not the runner's whole environment. */
  env: Record<string, string>;
  inheritEnv: boolean;
  host?: string;
  /** Used only when the process never announces a port. */
  port: number;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
};

function tail(text: string): string {
  if (text.length <= STDERR_TAIL) return text.trim();
  return text.slice(-STDERR_TAIL).trim();
}

function killChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
}

function waitForBridge(child: ChildProcess, fallbackPort: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => resolve(fallbackPort));
    }, timeoutMs);
    const take = (chunk: string, intoErr: boolean) => {
      if (intoErr) {
        err += chunk;
        if (err.length > STDERR_TAIL * 2) err = err.slice(-STDERR_TAIL * 2);
      } else {
        out += chunk;
      }
      const found = `${out}\n${err}`.match(PORT_LINE);
      if (found) finish(() => resolve(Number(found[1])));
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => take(chunk, false));
    child.stderr?.on('data', (chunk: string) => take(chunk, true));
    child.once('error', (error) => {
      finish(() => reject(new RpcDriverError(
        `could not start the game: ${error.message}`,
        'game.command is the executable; check that it is on PATH',
      )));
    });
    child.once('exit', (code) => {
      if (settled) return;
      const detail = tail(err || out);
      finish(() => reject(new RpcDriverError(
        `the game exited before the playtest bridge listened (code ${code ?? 'none'})${detail ? `: ${detail}` : ''}`,
        'the bridge must print PLAYTEST_BRIDGE_PORT=<n> after it is listening',
      )));
    });
  });
}

export async function launchRpcGame(opts: RpcLaunchOptions): Promise<Driver> {
  const connectTimeoutMs = opts.connectTimeoutMs ?? 10_000;
  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: buildChildEnv(opts.env, process.env, opts.inheritEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let port: number;
  try {
    port = await waitForBridge(child, opts.port, connectTimeoutMs);
  } catch (err) {
    killChild(child);
    throw err;
  }
  try {
    const inner = await createRpcDriver({
      host: opts.host,
      port,
      connectTimeoutMs,
      requestTimeoutMs: opts.requestTimeoutMs,
    });
    return {
      modality: inner.modality,
      get diagnostics() { return inner.diagnostics; },
      start: () => inner.start(),
      step: (action) => inner.step(action),
      async reset() {
        if (!inner.reset) {
          throw new RpcDriverError(
            'rpc driver has no reset()',
            'the launched bridge must answer reset',
          );
        }
        return inner.reset();
      },
      async stop() {
        try {
          await inner.stop();
        } finally {
          killChild(child);
        }
      },
    };
  } catch (err) {
    killChild(child);
    throw err;
  }
}
