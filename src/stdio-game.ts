// stdio-game.ts — drives any terminal game over stdin/stdout. The runner never
// parses the game; it only decides WHEN the game is waiting for a line: after a
// prompt pattern matches the stripped tail and the output has been quiet for
// `promptQuietMs`, or after `idleQuietMs` of silence with no match.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { GameConfig } from './config.js';

// ECMA-48 shaped, in \u escapes rather than literal control bytes.
//
// The previous version stored raw 0x1B / 0x07 in the source, which made it
// unreviewable — `cat`, editors and review UIs render those bytes invisibly, so
// the pattern a reader sees is not the pattern that runs. It also terminated OSC
// on the NEXT BEL anywhere in the buffer, so an ST-terminated OSC followed by a
// later BEL deleted everything between them (46 characters of narration in the
// measured case).
//
// Order matters: the string-terminated forms (OSC, DCS/SOS/PM/APC) are matched
// before CSI so a long payload cannot be mis-lexed by a shorter alternative.
//
// These patterns MUST be written with \u escapes (or fromCharCode / a shared
// ESC/BEL constant). Literal U+001B / U+0007 / C1 bytes are invisible in
// editors and review UIs; a well-meaning cleanup of "garbled" regexes would
// drop them and the OSC branch would truncate at the first ']'.
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const DCS = /\u001b[PX^_][^\u001b]*(?:\u001b\\)/g;
const CSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
// ESC + optional intermediates (0x20-0x2F) + a final byte (0x30-0x7E). This is
// every remaining two-or-three-character escape once OSC, DCS and CSI have been
// consumed above: ESC 7 / ESC 8 (DECSC/DECRC), ESC = / ESC >, ESC c, and
// charset selections like ESC ( B. An earlier form only covered 0x40-0x5F, so
// ESC 7 and ESC 8 kept their ESC byte and leaked it into the player's context.
const ESC2 = /\u001b[ -/]*[0-~]/g;
const C1 = /[\u001b\u009b\u009c\u009d]/g;

/**
 * Apply carriage returns within each line: `\r` returns to column 0 and later
 * text overwrites what was there, so `"Loading 10%\rLoading 99%"` renders as
 * `"Loading 99%"`, not as the two frames concatenated. Full redraws that use
 * cursor addressing are not recoverable this way — that is what the terminal
 * grid driver is for — but progress frames are, and they are common.
 */
function applyCarriageReturns(s: string): string {
  if (!s.includes('\r')) return s;
  return s
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      let out = '';
      for (const part of line.split('\r')) out = part + out.slice(part.length);
      return out;
    })
    .join('\n');
}

export function stripAnsi(s: string): string {
  const withoutEscapes = s
    .replace(OSC, '')
    .replace(DCS, '')
    .replace(CSI, '')
    .replace(ESC2, '')
    .replace(C1, '');
  return applyCarriageReturns(withoutEscapes);
}

/**
 * The environment a game process gets when `inheritEnv` is not set: enough to
 * find an interpreter and a temp directory, and nothing else.
 *
 * The child used to receive the runner's entire environment, which handed every
 * game under test the `OPENROUTER_API_KEY` — verified reaching a child's stdout,
 * which then flows into the player's context and the written report. A game
 * under test is arbitrary third-party or model-generated code; it has no reason
 * to hold the credential that pays for the playtest.
 */
const ENV_ALLOWLIST = [
  'PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR',
  'SystemRoot', 'SystemDrive', 'windir', 'COMSPEC', 'LANG', 'LC_ALL', 'TZ',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS', 'OS',
];

export function buildChildEnv(
  resolved: Record<string, string>,
  source: NodeJS.ProcessEnv,
  inheritEnv: boolean,
): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = inheritEnv ? { ...source } : {};
  if (!inheritEnv) {
    for (const key of ENV_ALLOWLIST) {
      const v = source[key];
      if (v !== undefined) base[key] = v;
    }
  }
  return { ...base, ...resolved, FORCE_COLOR: '0', NO_COLOR: '1' };
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
  /** Set when the process could not be started or its stdin broke. */
  readonly spawnError: Error | null;
};

export function spawnGame(cfg: GameConfig, env: Record<string, string>): GameProcess {
  const child: ChildProcessWithoutNullStreams = spawn(cfg.command, cfg.args, {
    cwd: cfg.cwd,
    env: buildChildEnv(env, process.env, cfg.inheritEnv === true),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const patterns = cfg.promptPatterns.map((p) => new RegExp(p, 'm'));
  // Sliding window: a redraw loop over screenTimeoutMs (default 180s) used to
  // grow without bound and OOM every parallel seat. Prompt matching only
  // needs the tail.
  const STDOUT_CAP = 2 * 1024 * 1024;
  const STDERR_CAP = 256 * 1024;
  const STDERR_TRUNC = '[stderr truncated]\n';
  let buf = '';
  let stderrBuf = '';
  // Only stdout activity may defer the prompt/idle decision. When stderr shared
  // this timestamp, a game that logged to stderr while waiting on stdout kept
  // `quiet` pinned near zero and never reached either branch: measured 3063ms
  // `timeout` on every turn where the correct answer was a 220ms `prompt`.
  let lastStdoutByteAt = Date.now();
  let exited = false;
  let exitCode: number | null = null;
  let spawnError: Error | null = null;

  const appendStderr = (chunk: string) => {
    stderrBuf += chunk;
    if (stderrBuf.length > STDERR_CAP) {
      const keep = STDERR_CAP - STDERR_TRUNC.length;
      stderrBuf = STDERR_TRUNC + stderrBuf.slice(-keep);
    }
  };

  // setEncoding keeps Node's StringDecoder across chunk boundaries. Decoding
  // each Buffer independently corrupted any multi-byte character split across
  // two 'data' events — 15 of 36 split points in a box-drawing sample.
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
    if (buf.length > STDOUT_CAP) buf = buf.slice(-STDOUT_CAP);
    lastStdoutByteAt = Date.now();
  });
  child.stderr.on('data', (d: string) => { appendStderr(d); });
  child.on('exit', (code) => { exited = true; exitCode = code; });
  child.on('error', (err) => {
    // Discarding this argument made the commonest first-run misconfiguration —
    // a wrong command path — indistinguishable from a game that printed nothing.
    spawnError = err;
    appendStderr(`[spawn error] ${err.message}\n`);
    exited = true;
    exitCode = exitCode ?? -1;
  });
  // stdin is a separate EventEmitter from the child; without this listener an
  // EPIPE after the game exits becomes an uncaught exception that takes down
  // the whole runner, killing every parallel seat.
  child.stdin.on('error', (err: Error) => {
    spawnError = spawnError ?? err;
    appendStderr(`[stdin error] ${err.message}\n`);
  });

  const take = (reason: Screen['reason']): Screen => {
    const text = stripAnsi(buf);
    buf = '';
    return { text, reason, exitCode };
  };

  return {
    send(line: string) {
      if (exited || !child.stdin.writable) return;
      try {
        child.stdin.write(line + '\n');
      } catch (err) {
        spawnError = spawnError ?? (err as Error);
      }
    },
    nextScreen(): Promise<Screen> {
      const started = Date.now();
      return new Promise((resolveScreen) => {
        const tick = () => {
          const now = Date.now();
          const quiet = now - lastStdoutByteAt;
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
    get spawnError() { return spawnError; },
  };
}
