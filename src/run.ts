// run.ts — one seat: spawn the game, let the model play N turns, quit, critique,
// write the artifacts. All seats: in parallel, each in its own directory.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlaytestConfig, Seat } from './config.js';
import { resolveEnv, ConfigError } from './config.js';
import type { ChatClient } from './openrouter.js';
import { spawnGame } from './stdio-game.js';
import type { Driver, Observation } from './driver.js';
import { createStdioDriver } from './stdio-driver.js';
import { chooseInput, type TurnRecord } from './player.js';
import { critique, type Critique } from './critic.js';
import { computeCoverage, type Coverage } from './coverage.js';
import { pickJurors, aggregatePanel, type PanelVerdict } from './panel.js';
import { runVerifiers, type VerifierReport } from './verifiers.js';

export type SeatResult = {
  seat: Seat;
  label: string;
  turnsPlayed: number;
  endedBy: 'turns' | 'exit' | 'timeout' | 'error';
  error?: string;
  /** Set when driver.stop() failed; judging and artifacts still proceed. */
  stopError?: string;
  /** Set when writeArtifacts() failed; the in-memory result is still returned. */
  writeError?: string;
  history: TurnRecord[];
  critique: Critique | null;
  critiqueError?: string;
  /** How much of the game this session actually saw. Computed from the turn records. */
  coverage: Coverage;
  /** Deterministic transcript checks. Precise and partial; never a softlock proof. */
  verifiers: VerifierReport;
  /**
   * The cross-family jury's reading of this transcript. Null when no other
   * family was seated, in which case `critique` (the author's own reading) is
   * all there is and the report says so.
   */
  panel: PanelVerdict | null;
  durationMs: number;
  dir: string;
};

export type RunOptions = {
  label: string;
  client: ChatClient;
  /** Extra attempts per turn after the client's own retries are exhausted (default 3). */
  turnRetries?: number;
  /** Wait between those attempts (default 30s). */
  turnRetrySleepMs?: number;
  /** Injectable for tests. */
  spawn?: typeof spawnGame;
  /** Injectable for tests, and the seam the pty/rpc drivers arrive through. */
  makeDriver?: (cfg: PlaytestConfig, env: Record<string, string>) => Promise<Driver>;
  env?: NodeJS.ProcessEnv;
  onTurn?: (seat: Seat, t: TurnRecord) => void;
  /** Fired before each extra turn-retry sleep so a provider outage is visible. */
  onRetry?: (seat: Seat, info: { turn: number; attempt: number; of: number; sleepMs: number; error: string }) => void;
  onSeatDone?: (r: SeatResult) => void;
};

function formatErr(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** A rejection that still carries the transcript so runAll does not wipe it. */
export class SeatRunError extends Error {
  readonly code = 'E_SEAT';
  constructor(message: string, readonly partial?: Partial<SeatResult>) {
    super(message);
    this.name = 'SeatRunError';
  }
}

async function withTurnRetries<T>(
  fn: () => Promise<T>,
  retries: number,
  sleepMs: number,
  onRetry?: (info: { attempt: number; of: number; sleepMs: number; error: string }) => void,
): Promise<{ value: T; attempts: number; lastError?: string }> {
  let lastErr: unknown;
  let lastError: string | undefined;
  const of = retries + 1;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      onRetry?.({ attempt, of, sleepMs, error: lastError ?? 'unknown' });
      await new Promise((r) => setTimeout(r, sleepMs));
    }
    try {
      return { value: await fn(), attempts: attempt + 1, lastError };
    } catch (err) {
      lastErr = err;
      lastError = formatErr(err);
    }
  }
  throw new Error(`player turn failed after ${of} attempts (${retries} sleeps of ${sleepMs}ms): ${lastError ?? formatErr(lastErr)}`);
}

/**
 * `label` comes from a CLI flag and `seat.id` from a config file, and both used
 * to be joined into a filesystem path unchecked — so `--label ../../etc` wrote
 * outside runsDir entirely.
 */
function safeSegment(value: string, what: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new ConfigError(
      `${what} "${value}" is not usable as a directory name`,
      'use letters, digits, dot, dash or underscore only — it becomes a folder under runsDir',
    );
  }
  return value;
}

export function seatDir(cfg: PlaytestConfig, label: string, seat: Seat): string {
  return join(cfg.runsDir, safeSegment(label, 'label'), safeSegment(seat.id, 'seat id'));
}

/**
 * Build the driver the config asked for. stdio is constructed inline; pty and
 * rpc are imported lazily so their optional dependencies are only required by
 * the runs that actually use them.
 */
export async function createDriver(cfg: PlaytestConfig, env: Record<string, string>): Promise<Driver> {
  switch (cfg.driver.kind) {
    case 'pty': {
      const { createPtyDriver } = await import('./pty-driver.js');
      return createPtyDriver({
        command: cfg.game.command,
        args: cfg.game.args,
        cwd: cfg.game.cwd,
        env: { ...env },
        inheritEnv: cfg.game.inheritEnv === true,
        cols: cfg.driver.cols,
        rows: cfg.driver.rows,
        readySentinel: cfg.driver.readySentinel,
        promptPatterns: cfg.game.promptPatterns,
        promptQuietMs: cfg.game.promptQuietMs,
        idleQuietMs: cfg.game.idleQuietMs,
        screenTimeoutMs: cfg.game.screenTimeoutMs,
      });
    }
    case 'rpc': {
      const { createRpcDriver } = await import('./rpc-driver.js');
      return createRpcDriver({
        host: cfg.driver.host,
        port: cfg.driver.port,
        connectTimeoutMs: cfg.driver.connectTimeoutMs,
        requestTimeoutMs: cfg.driver.requestTimeoutMs,
      });
    }
    default:
      return createStdioDriver({ game: cfg.game, env });
  }
}

async function critiqueJuror(
  client: ChatClient,
  juror: Seat,
  criteria: PlaytestConfig['criteria'],
  evidence: TurnRecord[],
  outcome: { endedBy: string; turnsPlayed: number; error?: string },
): Promise<{ seat: Seat; critique: Critique | null; error?: string }> {
  const once = () => critique(client, juror.model, criteria, evidence, { outcome });
  try {
    return { seat: juror, critique: await once() };
  } catch (first) {
    try {
      return { seat: juror, critique: await once() };
    } catch (second) {
      return { seat: juror, critique: null, error: `${formatErr(first)}; retry: ${formatErr(second)}` };
    }
  }
}

function trySeatDir(cfg: PlaytestConfig, label: string, seat: Seat): string {
  try {
    return seatDir(cfg, label, seat);
  } catch {
    // Synthesis must not throw: a bad label already failed every seat.
    return join(cfg.runsDir, 'invalid-label', 'invalid-seat');
  }
}

function partialFromRejection(reason: unknown): Partial<SeatResult> | undefined {
  if (reason instanceof SeatRunError) return reason.partial;
  if (reason && typeof reason === 'object' && 'partial' in reason) {
    const p = (reason as { partial?: Partial<SeatResult> }).partial;
    if (p && typeof p === 'object') return p;
  }
  return undefined;
}

export async function runSeat(cfg: PlaytestConfig, seat: Seat, opts: RunOptions): Promise<SeatResult> {
  const started = Date.now();
  const dir = seatDir(cfg, opts.label, seat);
  await mkdir(dir, { recursive: true });
  const env = resolveEnv(cfg.game.env, opts.env ?? process.env);
  const makeDriver = opts.makeDriver
    ?? (opts.spawn ? async (c: PlaytestConfig, e: Record<string, string>) => createStdioDriver({ game: c.game, env: e, spawn: opts.spawn }) : createDriver);
  const history: TurnRecord[] = [];
  let driver: Driver | undefined;
  let pendingScreen: Observation | null = null;
  let endedBy: SeatResult['endedBy'] = 'turns';
  let error: string | undefined;
  let stopError: string | undefined;
  let turn = 0;
  let diagnostics = '';
  let result: SeatResult | undefined;

  try {
    try {
      // makeDriver / start / setup compile can spawn or fail; they must sit
      // inside the same try/finally as stop so a rejected start cannot leak
      // the child.
      const game = await makeDriver(cfg, env);
      driver = game;
      pendingScreen = await game.start();
      const setupSteps = cfg.setup.map((st) => ({ re: new RegExp(st.match, 'm'), answer: st.answer }));
      let setupAnswers = 0;
      const MAX_SETUP_ANSWERS = 60;
      while (turn < cfg.turns) {
        const t0 = Date.now();
        const screen = pendingScreen ?? await game.step({ kind: 'line', line: '' });
        pendingScreen = null;
        if (screen.reason === 'exit') { endedBy = 'exit'; history.push({ turn: turn + 1, screen: screen.text, input: '', reason: 'exit', ms: Date.now() - t0 }); break; }
        if (screen.reason === 'timeout') { endedBy = 'timeout'; history.push({ turn: turn + 1, screen: screen.text, input: '', reason: 'timeout', ms: Date.now() - t0 }); break; }
        // Scripted setup: the first matching step answers without the player
        // and without spending a turn (recorded, so the transcript stays whole).
        const tail = screen.text.slice(-600);
        const step = setupSteps.find((st) => st.re.test(tail));
        if (step && setupAnswers < MAX_SETUP_ANSWERS) {
          setupAnswers++;
          const rec: TurnRecord = { turn: 0, screen: screen.text, input: step.answer, reason: 'setup', ms: Date.now() - t0 };
          history.push(rec);
          opts.onTurn?.(seat, rec);
          pendingScreen = await game.step({ kind: 'line', line: step.answer });
          continue;
        }
        // A player call can fail after the client's own retries (a provider
        // outage lasting minutes); the turn waits and tries again a few times
        // before the seat ends, so one bad minute does not void a session.
        const retries = opts.turnRetries ?? 3;
        const sleepMs = opts.turnRetrySleepMs ?? 30_000;
        const upcoming = turn + 1;
        const played = await withTurnRetries(
          () => chooseInput(opts.client, seat.model, cfg.persona, history, screen.text, {
            memoryTurns: cfg.playerMemoryTurns,
            screenChars: cfg.screenChars,
            temperature: cfg.playerTemperature,
          }),
          retries,
          sleepMs,
          (info) => {
            opts.onRetry?.(seat, { turn: upcoming, ...info });
            // Reuse onTurn so a CLI that only wired onTurn still prints a
            // heartbeat during the sleep rather than looking hung.
            opts.onTurn?.(seat, {
              turn: upcoming,
              screen: screen.text,
              input: `retry ${info.attempt}/${info.of} after ${info.sleepMs}ms: ${info.error}`,
              reason: 'retry',
              ms: info.sleepMs,
              attempts: info.attempt,
              lastError: info.error,
            });
          },
        );
        turn++;
        const rec: TurnRecord = {
          turn, screen: screen.text, input: played.value, reason: screen.reason, ms: Date.now() - t0,
          attempts: played.attempts, lastError: played.lastError,
        };
        history.push(rec);
        opts.onTurn?.(seat, rec);
        pendingScreen = await game.step({ kind: 'line', line: played.value });
      }
      // The screen produced by the last player input is evidence of THAT input.
      // The quit loop used to consume it and label it `quit`, which dropped the
      // last action's result from coverage and from the critic (quit records are
      // filtered out of evidence). Record it first, then send the runner's quit.
      // Skip both steps when the player already ended the game -- sending quit
      // to a dead process recorded a phantom extra turn (reason 'exit', input
      // 'quit') that playerTurns counted.
      if (endedBy === 'turns') {
        if (pendingScreen) {
          history.push({ turn, screen: pendingScreen.text, input: '', reason: pendingScreen.reason, ms: 0 });
        }
        if (!(pendingScreen?.done ?? false) && pendingScreen?.reason !== 'exit' && pendingScreen?.reason !== 'timeout') {
          for (const q of cfg.game.quitInputs) {
            const t0 = Date.now();
            const screen = await game.step({ kind: 'line', line: q });
            pendingScreen = screen;
            history.push({ turn, screen: screen.text, input: q, reason: 'quit', ms: Date.now() - t0 });
            if (screen.reason === 'exit' || screen.reason === 'timeout') break;
          }
        }
      }
    } catch (err) {
      endedBy = 'error';
      error = formatErr(err);
    } finally {
      if (driver) {
        try {
          await driver.stop();
        } catch (err) {
          stopError = formatErr(err);
        }
        diagnostics = driver.diagnostics;
      }
    }

    let crit: Critique | null = null;
    let critiqueError: string | undefined;
    // The player's own turns, for counting. Setup answers and the quit sequence
    // are the runner's inputs, not the player's.
    const playerTurns = history.filter((h) => h.input.length > 0 && h.reason !== 'setup' && h.reason !== 'quit');
    // The evidence the critic sees keeps the terminal screens — the consequence
    // of the last input, the save recap, the crash output. Dropping every record
    // with no input made endings, stalls and crashes invisible to the verdict.
    const evidence = history.filter((h) => h.reason !== 'setup' && h.reason !== 'quit');
    let panel: PanelVerdict | null = null;
    if (playerTurns.length > 0) {
      const outcome = { endedBy, turnsPlayed: playerTurns.length, error };
      // The author's own reading is kept, but as TESTIMONY -- a first-person
      // account of where it was confused and what it tried. It is not the score.
      try {
        crit = await critique(opts.client, seat.model, cfg.criteria, evidence, { outcome });
      } catch (err) {
        critiqueError = formatErr(err);
      }
      // The score comes from families that did not write this transcript.
      const requested = cfg.panelSize;
      const otherFamily = cfg.seats.some((s) => s.family !== seat.family);
      if (requested === 0) {
        panel = aggregatePanel([], [], cfg.criteria, { requested: 0 });
      } else if (!otherFamily) {
        panel = null;
      } else {
        const jurors = pickJurors(cfg.seats, seat, requested);
        const critiques = await Promise.all(jurors.map((juror) =>
          critiqueJuror(opts.client, juror, cfg.criteria, evidence, outcome)));
        panel = aggregatePanel(jurors, critiques, cfg.criteria, { requested });
      }
    } else {
      // A session where the player never moved used to produce a full, confident
      // verdict over a transcript containing only the runner's own quit input.
      critiqueError = `no player turns were taken (ended by ${endedBy}); nothing to judge`;
      if (endedBy === 'turns') endedBy = 'error';
      error = error ?? 'the player took no turns';
    }

    result = {
      seat, label: opts.label, turnsPlayed: playerTurns.length, endedBy, error, stopError, history,
      critique: crit, critiqueError,
      coverage: computeCoverage(history),
      verifiers: runVerifiers(history, cfg.verifiers),
      panel,
      durationMs: Date.now() - started, dir,
    };
    try {
      await writeArtifacts(cfg, result, diagnostics);
    } catch (err) {
      result.writeError = formatErr(err);
      result.error = result.error ?? result.writeError;
    }
    opts.onSeatDone?.(result);
    return result;
  } catch (err) {
    const partial: Partial<SeatResult> = result ?? {
      seat, label: opts.label, history, endedBy, error: error ?? formatErr(err), stopError, dir,
      turnsPlayed: history.filter((h) => h.input.length > 0 && h.reason !== 'setup' && h.reason !== 'quit').length,
      critique: null,
      coverage: computeCoverage(history),
      verifiers: runVerifiers(history, cfg.verifiers),
      panel: null,
      durationMs: Date.now() - started,
    };
    if (err instanceof SeatRunError) throw err;
    throw new SeatRunError(formatErr(err), partial);
  }
}

async function writeArtifacts(cfg: PlaytestConfig, r: SeatResult, stderr: string): Promise<void> {
  const extra = [
    r.stopError ? `, stopError: ${r.stopError}` : '',
    r.writeError ? `, writeError: ${r.writeError}` : '',
  ].join('');
  const lines: string[] = [
    `# ai-playtest transcript -- ${cfg.name} -- seat ${r.seat.id} (${r.seat.family}: ${r.seat.model}) -- label ${r.label}`,
    `# turns ${r.turnsPlayed}, ended by ${r.endedBy}${r.error ? `, error: ${r.error}` : ''}${extra}, ${Math.round(r.durationMs / 1000)}s`,
    '',
  ];
  for (const t of r.history) {
    lines.push(t.reason === 'setup' ? `═══ setup ── screen (${t.ms}ms)` : `═══ turn ${t.turn} ── screen (${t.reason}, ${t.ms}ms)`);
    if ((t.attempts ?? 1) > 1 || t.lastError) {
      lines.push(`# attempts ${t.attempts ?? 1}${t.lastError ? `; last retry error: ${t.lastError}` : ''}`);
    }
    lines.push(t.screen.trimEnd());
    if (t.input) lines.push(`> ${t.input}`);
    lines.push('');
  }
  await writeFile(join(r.dir, 'transcript.txt'), lines.join('\n') + '\n', 'utf8');
  await writeFile(join(r.dir, 'critique.json'), JSON.stringify(r.critique ?? { error: r.critiqueError ?? 'no turns played' }, null, 2) + '\n', 'utf8');
  await writeFile(join(r.dir, 'meta.json'), JSON.stringify({
    name: cfg.name, label: r.label, seat: r.seat, turns: cfg.turns, turnsPlayed: r.turnsPlayed, endedBy: r.endedBy,
    error: r.error ?? null, stopError: r.stopError ?? null, writeError: r.writeError ?? null,
    critiqueError: r.critiqueError ?? null, coverage: r.coverage, panel: r.panel, verifiers: r.verifiers,
    durationMs: r.durationMs, finishedAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf8');
  if (stderr.trim().length > 0) await writeFile(join(r.dir, 'stderr.txt'), stderr, 'utf8');
}

export async function runAll(cfg: PlaytestConfig, opts: RunOptions & { seats?: string[]; parallel?: boolean }): Promise<SeatResult[]> {
  const seats = opts.seats && opts.seats.length > 0 ? cfg.seats.filter((s) => opts.seats!.includes(s.id)) : cfg.seats;
  if (opts.parallel === false) {
    const out: SeatResult[] = [];
    for (const s of seats) out.push(await runSeat(cfg, s, opts));
    return out;
  }
  // allSettled, not all: a single seat's rejection used to discard every
  // sibling's result even though their artifacts were already on disk, turning
  // one bad seat into a lost run.
  const settled = await Promise.allSettled(seats.map((s) => runSeat(cfg, s, opts)));
  const out: SeatResult[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') { out.push(r.value); return; }
    const seat = seats[i];
    const partial = partialFromRejection(r.reason);
    const history = partial?.history ?? [];
    out.push({
      seat,
      label: partial?.label ?? opts.label,
      turnsPlayed: partial?.turnsPlayed ?? 0,
      endedBy: partial?.endedBy ?? 'error',
      error: formatErr(r.reason),
      stopError: partial?.stopError,
      writeError: partial?.writeError,
      history,
      critique: partial?.critique ?? null,
      critiqueError: partial?.critiqueError ?? (history.length > 0 ? undefined : 'the seat threw before producing a critique'),
      coverage: partial?.coverage ?? computeCoverage(history),
      verifiers: partial?.verifiers ?? runVerifiers(history),
      panel: partial?.panel ?? null,
      durationMs: partial?.durationMs ?? 0,
      dir: partial?.dir ?? trySeatDir(cfg, opts.label, seat),
    });
  });
  return out;
}
