// pty-driver.ts — observes a game through a pseudo-terminal and a headless
// terminal emulator, so the screen is a GRID rather than an append-only log.
//
// Why this exists, beyond TUI support:
//
// 1. A full-screen game (ratatui, ncurses) redraws with cursor addressing. Fed
//    to a line-append reader, three redraws of one screen become three stacked
//    copies with the player's echoed input interleaved — measured at 416
//    characters of ambiguity where the grid was 115 characters of current
//    state, with three contradictory HP values in the log. The model has to
//    guess which is current. With a grid it cannot get that wrong.
//
// 2. Under a PIPE, a C program's stdout becomes fully buffered (4 KB) instead
//    of line buffered. "Quiet for N ms" then fires on a program that has simply
//    not flushed — so the stdio driver's readiness rule is unsound for any game
//    that does not flush explicitly. A PTY restores line buffering.
//
// 3. On Windows, a pipe captures nothing at all from a game that draws through
//    the Console API; only ConPTY turns those calls into bytes.
//
// Caveats worth knowing: a PTY merges stderr into stdout (there is one stream,
// so `diagnostics` stays empty here), `@xterm/headless` is CJS-only, and
// node-pty ships no Linux prebuilds — which is why both are optional
// dependencies and this module is loaded lazily.

import type { Driver, Observation, Action, ActionSpace, ReadyReason } from './driver.js';
import { actionToLine } from './driver.js';
import { buildChildEnv } from './stdio-game.js';

export type PtyDriverOptions = {
  command: string;
  args: string[];
  cwd?: string;
  /**
   * Extra environment overlaid on the allowlisted spawn env. This is NOT the
   * entire child environment — PATH/SystemRoot and the rest of the allowlist
   * still come from the runner unless inheritEnv is set.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Pass the runner's entire environment to the TUI child. Off by default:
   * a game under test is arbitrary code and must not receive OPENROUTER_API_KEY.
   */
  inheritEnv?: boolean;
  cols?: number;
  rows?: number;
  /** Regexes tested against the RENDERED cursor line, not a raw byte tail. */
  promptPatterns: string[];
  promptQuietMs: number;
  idleQuietMs: number;
  screenTimeoutMs: number;
  /**
   * A line the game prints when it is ready for input. If the game can emit
   * one, readiness stops being a guess — this is the only sound signal, and it
   * is why the option exists even though most games will not use it.
   */
  readySentinel?: string;
  actions?: ActionSpace;
};

type PtyModule = typeof import('node-pty');

export class PtyUnavailableError extends Error {
  readonly code = 'E_PTY_UNAVAILABLE';
  constructor(readonly hint: string, cause?: unknown) {
    super(`the pty driver needs node-pty and @xterm/headless${cause instanceof Error ? `: ${cause.message}` : ''}`);
  }
}

type StderrWrite = typeof process.stderr.write;

let stderrFilterDepth = 0;
let stderrOrigWrite: StderrWrite | undefined;
let stderrFilterInstalled: StderrWrite | undefined;
const attachConsoleListeners = new Set<() => void>();

/** Swallow node-pty's Windows `AttachConsole failed` ConPTY noise while any PTY driver is live. */
function pushAttachConsoleFilter(onHit: () => void): () => void {
  attachConsoleListeners.add(onHit);
  if (stderrFilterDepth === 0) {
    stderrOrigWrite = process.stderr.write.bind(process.stderr) as StderrWrite;
    const filter = ((chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
      const s = typeof chunk === 'string'
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString('utf8')
          : String(chunk);
      if (/AttachConsole failed/i.test(s)) {
        for (const hit of attachConsoleListeners) hit();
        const done = typeof encoding === 'function' ? encoding : typeof cb === 'function' ? cb : undefined;
        if (typeof done === 'function') (done as () => void)();
        return true;
      }
      return (stderrOrigWrite as (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean)(chunk, encoding, cb);
    }) as StderrWrite;
    stderrFilterInstalled = filter;
    process.stderr.write = filter;
  }
  stderrFilterDepth++;
  let popped = false;
  return () => {
    if (popped) return;
    popped = true;
    attachConsoleListeners.delete(onHit);
    stderrFilterDepth = Math.max(0, stderrFilterDepth - 1);
    if (stderrFilterDepth === 0 && stderrOrigWrite && process.stderr.write === stderrFilterInstalled) {
      process.stderr.write = stderrOrigWrite;
      stderrOrigWrite = undefined;
      stderrFilterInstalled = undefined;
    }
  };
}

async function loadPty(): Promise<{ pty: PtyModule; Terminal: any }> {
  try {
    const pty = (await import('node-pty')) as PtyModule;
    // @xterm/headless is CommonJS, so the namespace import has to be unwrapped.
    const mod: any = await import('@xterm/headless');
    const Terminal = mod.Terminal ?? mod.default?.Terminal;
    if (!Terminal) throw new Error('@xterm/headless exported no Terminal');
    return { pty, Terminal };
  } catch (err) {
    throw new PtyUnavailableError(
      'install the optional deps: npm install node-pty @xterm/headless (node-pty has no Linux prebuild and will compile there)',
      err,
    );
  }
}

export async function createPtyDriver(opts: PtyDriverOptions): Promise<Driver> {
  const { pty, Terminal } = await loadPty();
  const cols = opts.cols ?? 100;
  const rows = opts.rows ?? 30;
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  const patterns = opts.promptPatterns.map((p) => new RegExp(p, 'm'));

  let lastByteAt = Date.now();
  let exited = false;
  let exitCode: number | null = null;
  let sawSentinel = false;
  let sawByte = false;
  let bracketedPaste = false;
  let altScreen = false;
  let writesInFlight = 0;
  const sentinel = opts.readySentinel && opts.readySentinel.length > 0 ? opts.readySentinel : undefined;
  const tailMax = Math.max(8192, (sentinel?.length ?? 0) + 64);
  let byteTail = '';
  let taggedAttachConsole = false;
  let diagnostics = 'PTY has no separate stderr; the child\'s stdout and stderr are merged into the grid.';
  const restoreStderr = pushAttachConsoleFilter(() => {
    if (!taggedAttachConsole) {
      taggedAttachConsole = true;
      diagnostics += '\n[pty] node-pty AttachConsole failed is ConPTY noise on Windows, not a game error.';
    }
  });

  // DEC private mode set/reset. ?2004h means the terminal turned on bracketed
  // paste, which readline does when it starts reading a line — the one
  // readiness signal available from an uninstrumented program. ?1049h is the
  // alternate screen buffer, i.e. "this is a full-screen TUI".
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params: number[]) => {
    if (params.includes(2004)) bracketedPaste = true;
    if (params.includes(1049)) altScreen = true;
    return false;
  });
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params: number[]) => {
    if (params.includes(2004)) bracketedPaste = false;
    if (params.includes(1049)) altScreen = false;
    return false;
  });

  const overlay: Record<string, string> = {};
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (typeof v === 'string') overlay[k] = v;
    }
  }

  let child: ReturnType<PtyModule['spawn']>;
  try {
    child = pty.spawn(opts.command, opts.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: opts.cwd ?? process.cwd(),
      env: buildChildEnv(overlay, process.env, opts.inheritEnv === true) as Record<string, string>,
    });
  } catch (err) {
    restoreStderr();
    diagnostics += `\n[pty] spawn failed: ${err instanceof Error ? err.message : String(err)}`;
    throw err;
  }

  child.onData((d: string) => {
    lastByteAt = Date.now();
    if (d.length > 0) sawByte = true;
    if (sentinel) {
      byteTail = (byteTail + d).slice(-tailMax);
      // Consume every complete match so a prior token cannot re-arm the
      // next turn. Keep the remainder: a split prefix of a later token
      // can still complete across the next onData (F-77dc267f).
      let idx = byteTail.indexOf(sentinel);
      if (idx !== -1) {
        sawSentinel = true;
        do {
          byteTail = byteTail.slice(idx + sentinel.length);
          idx = byteTail.indexOf(sentinel);
        } while (idx !== -1);
      }
    }
    writesInFlight++;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      writesInFlight = Math.max(0, writesInFlight - 1);
    };
    term.write(d, done);
    setTimeout(done, 250);
  });
  child.onExit(({ exitCode: c }: { exitCode: number }) => { exited = true; exitCode = c; });

  const gridLines = (): string[] => {
    const b = term.buffer.active;
    const out: string[] = [];
    for (let y = 0; y < b.length; y++) out.push(b.getLine(y)?.translateToString(true) ?? '');
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    return out;
  };

  const observe = (reason: ReadyReason): Observation => {
    const lines = gridLines();
    const b = term.buffer.active;
    return {
      text: lines.join('\n'),
      grid: { rows, cols, lines, cursor: { x: b.cursorX, y: b.cursorY }, altScreen },
      actions: opts.actions,
      reason,
      done: exited,
      exitCode,
    };
  };

  async function waitForTurn(): Promise<Observation> {
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 50));
      if (exited) return observe('exit');
      if (Date.now() - started > opts.screenTimeoutMs) return observe('timeout');
      // The grid lags the raw bytes until term.write's callback; do not
      // return sentinel/prompt against a frame that has not been rendered.
      if (writesInFlight > 0) continue;
      const quiet = Date.now() - lastByteAt;
      // Tiered, best evidence first. Each tier is weaker than the one above it,
      // and the observation records which one fired so a reader can tell a
      // known-ready turn from a guess.
      if (sawSentinel) { sawSentinel = false; return observe('sentinel'); }
      // Mirror the stdio empty-buffer guard: idle/prompt/ready-signal on a
      // still-empty grid makes a slow TUI look dead rather than not-up-yet.
      // Timeout remains the path for a game that never prints.
      if (!sawByte) continue;
      if (bracketedPaste && quiet >= opts.promptQuietMs) return observe('ready-signal');
      if (quiet >= opts.promptQuietMs) {
        const b = term.buffer.active;
        const cursorLine = b.getLine(b.cursorY)?.translateToString(true) ?? '';
        if (patterns.some((re) => re.test(cursorLine))) return observe('prompt');
      }
      if (quiet >= opts.idleQuietMs) return observe('idle');
    }
  }

  return {
    modality: 'pty',
    get diagnostics() { return diagnostics; },
    async start() { return waitForTurn(); },
    async step(action: Action) {
      if (!exited) child.write(actionToLine(action) + '\r');
      return waitForTurn();
    },
    async stop() {
      if (!exited) {
        try { child.kill(); }
        catch (err) {
          diagnostics += `\n[pty] kill failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      restoreStderr();
    },
  };
}
