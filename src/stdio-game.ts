// stdio-game.ts — drives any terminal game over stdin/stdout. The runner never
// parses the game; it only decides WHEN the game is waiting for a line: after a
// prompt pattern matches the stripped tail and the output has been quiet for
// `promptQuietMs`, or after `idleQuietMs` of silence with no match.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { GameConfig } from './config.js';

const ANSI = /\[[0-9;?]*[A-Za-z]|\][^]*|\r/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

export type Screen = {
  text: string;
  /** How the runner decided the game was waiting. */
  reason: 'prompt' | 'idle' | 'exit' | 'timeout';
  exitCode: number | null;
};

export type GameProcess = {
  send(line: string): void;
  /** Resolves with everything printed since the last screen, once the game waits (or exits/stalls). */
  nextScreen(): Promise<Screen>;
  kill(): void;
  readonly exited: boolean;
  readonly exitCode: number | null;
  readonly stderr: string;
};

export function spawnGame(cfg: GameConfig, env: Record<string, string>): GameProcess {
  const child: ChildProcessWithoutNullStreams = spawn(cfg.command, cfg.args, {
    cwd: cfg.cwd,
    env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const patterns = cfg.promptPatterns.map((p) => new RegExp(p, 'm'));
  let buf = '';
  let stderrBuf = '';
  let lastByteAt = Date.now();
  let exited = false;
  let exitCode: number | null = null;
  child.stdout.on('data', (d: Buffer) => { buf += d.toString('utf8'); lastByteAt = Date.now(); });
  child.stderr.on('data', (d: Buffer) => { stderrBuf += d.toString('utf8'); lastByteAt = Date.now(); });
  child.on('exit', (code) => { exited = true; exitCode = code; });
  child.on('error', () => { exited = true; exitCode = exitCode ?? -1; });

  const take = (reason: Screen['reason']): Screen => {
    const text = stripAnsi(buf);
    buf = '';
    return { text, reason, exitCode };
  };

  return {
    send(line: string) {
      if (!exited) child.stdin.write(line + '\n');
    },
    nextScreen(): Promise<Screen> {
      const started = Date.now();
      return new Promise((resolveScreen) => {
        const tick = () => {
          const now = Date.now();
          const quiet = now - lastByteAt;
          if (exited) return resolveScreen(take('exit'));
          if (now - started > cfg.screenTimeoutMs) return resolveScreen(take('timeout'));
          if (buf.length > 0) {
            const tail = stripAnsi(buf).slice(-400);
            if (quiet >= cfg.promptQuietMs && patterns.some((p) => p.test(tail))) return resolveScreen(take('prompt'));
            if (quiet >= cfg.idleQuietMs) return resolveScreen(take('idle'));
          }
          setTimeout(tick, 100);
        };
        tick();
      });
    },
    kill() {
      if (!exited) child.kill();
    },
    get exited() { return exited; },
    get exitCode() { return exitCode; },
    get stderr() { return stderrBuf; },
  };
}
