// run.ts — one seat: spawn the game, let the model play N turns, quit, critique,
// write the artifacts. All seats: in parallel, each in its own directory.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlaytestConfig, Seat } from './config.js';
import { resolveEnv, ConfigError, VERSION, SCHEMA_VERSION } from './config.js';
import type { ChatClient } from './openrouter.js';
import { spawnGame } from './stdio-game.js';
import type { Action, ActionSpace, Driver, Observation } from './driver.js';
import { ActionError, describeActions } from './driver.js';
import { createStdioDriver } from './stdio-driver.js';
import { chooseInput, type TurnRecord } from './player.js';
import { critique, CritiqueError, type Critique } from './critic.js';
import { computeCoverage, playerTurns as chosenTurns, type Coverage } from './coverage.js';
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
  /** True when scripted setup hit MAX_SETUP_ANSWERS and later matches were ignored. */
  setupCapped?: boolean;
  /** Last raw critic body when parse/transport failed. Also written to critique.raw.txt. */
  critiqueRaw?: string;
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
  /**
   * Reuse a driver already started by runAll (serial rpc panel). Skips
   * makeDriver and stop; start is skipped when `initialObservation` is set.
   */
  sharedDriver?: Driver;
  /** First observation when start() or reset() already ran for this seat. */
  initialObservation?: Observation;
  /** When false, runSeat does not stop the driver. Default true. */
  manageLifecycle?: boolean;
  env?: NodeJS.ProcessEnv;
  onTurn?: (seat: Seat, t: TurnRecord) => void;
  /** Fired before each extra turn-retry sleep so a provider outage is visible. */
  onRetry?: (seat: Seat, info: { turn: number; attempt: number; of: number; sleepMs: number; error: string }) => void;
  onSeatDone?: (r: SeatResult) => void;
};

/**
 * Map a player reply onto the current action space.
 * choice id/label → choose, key in set → key, else line. Closed sets throw
 * ActionError so the runner can record a harness event instead of stepping.
 * Local copy: io-seams may later export actionFromInput from driver.ts.
 */
export function toAction(input: string, space: ActionSpace | undefined): Action {
  const line = input;
  if (!space || space.kind === 'free-text') return { kind: 'line', line };
  if (space.kind === 'choice') {
    const exactId = space.options.find((o) => o.id === line);
    if (exactId) return { kind: 'choose', id: exactId.id };
    const lower = line.toLowerCase();
    const ciId = space.options.find((o) => o.id.toLowerCase() === lower);
    if (ciId) return { kind: 'choose', id: ciId.id };
    const byLabel = space.options.find((o) => o.label === line || o.label.toLowerCase() === lower);
    if (byLabel) return { kind: 'choose', id: byLabel.id };
    throw new ActionError(
      `input ${JSON.stringify(line)} is not a legal choice`,
      `legal ids: ${space.options.map((o) => o.id).join(', ')}`,
    );
  }
  if (space.kind === 'keys') {
    if (space.keys.includes(line)) return { kind: 'key', key: line };
    const found = space.keys.find((k) => k.toLowerCase() === line.toLowerCase());
    if (found) return { kind: 'key', key: found };
    throw new ActionError(
      `input ${JSON.stringify(line)} is not a legal key`,
      `legal keys: ${space.keys.join(' ')}`,
    );
  }
  return { kind: 'line', line };
}

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
    case 'stdio':
      return createStdioDriver({ game: cfg.game, env });
    default: {
      const unexpected: never = cfg.driver;
      throw new ConfigError(
        `unknown driver kind "${String((unexpected as { kind?: unknown }).kind)}"`,
        'driver.kind must be one of: stdio, pty, rpc',
      );
    }
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
  let setupCapped = false;

  try {
    try {
      // makeDriver / start / setup compile can spawn or fail; they must sit
      // inside the same try/finally as stop so a rejected start cannot leak
      // the child. sharedDriver skips makeDriver (and stop, in finally).
      const game = opts.sharedDriver ?? await makeDriver(cfg, env);
      driver = game;
      pendingScreen = opts.initialObservation ?? await game.start();
      const setupSteps = cfg.setup.map((st) => ({ re: new RegExp(st.match, 'm'), answer: st.answer }));
      let setupAnswers = 0;
      const MAX_SETUP_ANSWERS = 60;
      while (turn < cfg.turns) {
        const t0 = Date.now();
        const screen: Observation = pendingScreen ?? await game.step({ kind: 'line', line: '' });
        pendingScreen = null;
        if (screen.reason === 'exit') { endedBy = 'exit'; history.push({ turn: turn + 1, screen: screen.text, input: '', reason: 'exit', ms: Date.now() - t0, state: screen.state }); break; }
        if (screen.reason === 'timeout') { endedBy = 'timeout'; history.push({ turn: turn + 1, screen: screen.text, input: '', reason: 'timeout', ms: Date.now() - t0, state: screen.state }); break; }
        // Scripted setup: the first matching step answers without the player
        // and without spending a turn (recorded, so the transcript stays whole).
        const tail = screen.text.slice(-600);
        const step = setupSteps.find((st) => st.re.test(tail));
        if (step && setupAnswers < MAX_SETUP_ANSWERS) {
          setupAnswers++;
          if (setupAnswers >= MAX_SETUP_ANSWERS) setupCapped = true;
          const rec: TurnRecord = { turn: 0, screen: screen.text, input: step.answer, reason: 'setup', ms: Date.now() - t0, state: screen.state };
          history.push(rec);
          opts.onTurn?.(seat, rec);
          pendingScreen = await game.step({ kind: 'line', line: step.answer });
          continue;
        }
        if (step && setupAnswers >= MAX_SETUP_ANSWERS) {
          // Cap hit: do not apply further setup matches. The player sees the
          // menu; setupCapped is recorded so this is not scored as a choice.
          setupCapped = true;
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
            actionHint: describeActions(screen.actions) || undefined,
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
        const choice = played.value;
        let action: Action;
        try {
          action = toAction(choice.input, screen.actions);
        } catch (err) {
          if (!(err instanceof ActionError)) throw err;
          turn++;
          const rec: TurnRecord = {
            turn, screen: screen.text, input: choice.input,
            reason: 'illegal-action',
            ms: Date.now() - t0,
            attempts: played.attempts, lastError: err.message,
            state: screen.state,
          };
          history.push(rec);
          opts.onTurn?.(seat, rec);
          pendingScreen = screen;
          continue;
        }
        turn++;
        const rec: TurnRecord = {
          turn, screen: screen.text, input: choice.input,
          reason: choice.fallback ? 'look-fallback' : screen.reason,
          ms: Date.now() - t0,
          attempts: played.attempts, lastError: played.lastError,
          fallback: choice.fallback || undefined,
          rawSnippet: choice.rawSnippet,
          state: screen.state,
        };
        history.push(rec);
        opts.onTurn?.(seat, rec);
        pendingScreen = await game.step(action);
      }
      // The screen produced by the last player input is evidence of THAT input.
      // Recorded with input:'' so the critic sees it. playerTurns still excludes
      // empty input (turnsPlayed stays the count of chosen actions);
      // coverage.analysisTurns / runVerifiers fold the row in as the result of
      // the previous player turn so novelty, self-loops, absorbing SCC and
      // terminals see the final state. The quit loop used to consume it and
      // label it `quit`, which dropped it from both consumers.
      // Skip both steps when the player already ended the game -- sending quit
      // to a dead process recorded a phantom extra turn (reason 'exit', input
      // 'quit') that playerTurns counted.
      if (endedBy === 'turns') {
        if (pendingScreen) {
          history.push({ turn, screen: pendingScreen.text, input: '', reason: pendingScreen.reason, ms: 0, state: pendingScreen.state });
          if (pendingScreen.reason === 'timeout') endedBy = 'timeout';
        }
        if (!(pendingScreen?.done ?? false) && pendingScreen?.reason !== 'exit' && pendingScreen?.reason !== 'timeout') {
          for (const q of cfg.game.quitInputs) {
            const t0 = Date.now();
            const screen = await game.step({ kind: 'line', line: q });
            pendingScreen = screen;
            history.push({ turn, screen: screen.text, input: q, reason: 'quit', ms: Date.now() - t0, state: screen.state });
            if (screen.reason === 'exit' || screen.reason === 'timeout') break;
          }
        }
      }
    } catch (err) {
      endedBy = 'error';
      error = formatErr(err);
    } finally {
      if (driver) {
        const manage = opts.manageLifecycle !== false && !opts.sharedDriver;
        if (manage) {
          try {
            await driver.stop();
          } catch (err) {
            stopError = formatErr(err);
          }
        }
        diagnostics = driver.diagnostics;
      }
    }

    let crit: Critique | null = null;
    let critiqueError: string | undefined;
    let critiqueRaw: string | undefined;
    // The player's own turns, for counting. Setup answers and the quit sequence
    // are the runner's inputs, not the player's.
    const playerTurns = chosenTurns(history);
    // The evidence the critic sees keeps the terminal screens — the consequence
    // of the last input, the save recap, the crash output. Dropping every record
    // with no input made endings, stalls and crashes invisible to the verdict.
    const evidence = history.filter((h) => h.reason !== 'setup' && h.reason !== 'quit' && h.reason !== 'retry');
    let panel: PanelVerdict | null = null;
    const shouldJudge = playerTurns.length > 0
      || endedBy === 'timeout'
      || (endedBy === 'error' && evidence.length > 0);
    if (shouldJudge) {
      const outcome = { endedBy, turnsPlayed: playerTurns.length, error };
      // The author's own reading is kept, but as TESTIMONY -- a first-person
      // account of where it was confused and what it tried. It is not the score.
      try {
        crit = await critique(opts.client, seat.model, cfg.criteria, evidence, { outcome });
      } catch (err) {
        critiqueError = formatErr(err);
        if (err instanceof CritiqueError && err.raw !== undefined) critiqueRaw = err.raw;
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
      critique: crit, critiqueError, critiqueRaw, setupCapped: setupCapped || undefined,
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
      turnsPlayed: chosenTurns(history).length,
      critique: null,
      setupCapped: setupCapped || undefined,
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
    r.setupCapped ? ', setupCapped: true' : '',
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
    if (t.fallback) {
      lines.push(`# look-fallback: model reply discarded${t.rawSnippet ? `; raw ${JSON.stringify(t.rawSnippet)}` : ''}; runner sent ${JSON.stringify(t.input)}`);
    }
    if (t.reason === 'illegal-action') {
      lines.push(`# illegal-action: ${JSON.stringify(t.input)} is not in the current action space; runner did not step`);
    }
    lines.push(t.screen.trimEnd());
    if (t.input) lines.push(`> ${t.input}`);
    lines.push('');
  }
  await writeFile(join(r.dir, 'transcript.txt'), lines.join('\n') + '\n', 'utf8');
  const critiquePayload = r.critique ?? {
    error: r.critiqueError ?? 'no turns played',
    ...(r.critiqueRaw ? { raw: r.critiqueRaw } : {}),
  };
  await writeFile(join(r.dir, 'critique.json'), JSON.stringify(critiquePayload, null, 2) + '\n', 'utf8');
  if (r.critiqueRaw) await writeFile(join(r.dir, 'critique.raw.txt'), r.critiqueRaw, 'utf8');
  await writeFile(join(r.dir, 'meta.json'), JSON.stringify({
    name: cfg.name, label: r.label, seat: r.seat, turns: cfg.turns, turnsPlayed: r.turnsPlayed, endedBy: r.endedBy,
    schemaVersion: cfg.schemaVersion ?? SCHEMA_VERSION, toolVersion: VERSION,
    error: r.error ?? null, stopError: r.stopError ?? null, writeError: r.writeError ?? null,
    critiqueError: r.critiqueError ?? null, setupCapped: r.setupCapped ?? false,
    coverage: r.coverage, panel: r.panel, verifiers: r.verifiers,
    durationMs: r.durationMs, finishedAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf8');
  if (stderr.trim().length > 0) await writeFile(join(r.dir, 'stderr.txt'), stderr, 'utf8');
}

function failedSeat(cfg: PlaytestConfig, seat: Seat, opts: RunOptions, error: string): SeatResult {
  const history: TurnRecord[] = [];
  return {
    seat,
    label: opts.label,
    turnsPlayed: 0,
    endedBy: 'error',
    error,
    history,
    critique: null,
    coverage: computeCoverage(history),
    verifiers: runVerifiers(history),
    panel: null,
    durationMs: 0,
    dir: trySeatDir(cfg, opts.label, seat),
  };
}

function settleRejectedSeat(cfg: PlaytestConfig, seat: Seat, opts: RunOptions, reason: unknown): SeatResult {
  const partial = partialFromRejection(reason);
  const history = partial?.history ?? [];
  return {
    seat,
    label: partial?.label ?? opts.label,
    turnsPlayed: partial?.turnsPlayed ?? 0,
    endedBy: partial?.endedBy ?? 'error',
    error: formatErr(reason),
    stopError: partial?.stopError,
    writeError: partial?.writeError,
    history,
    critique: partial?.critique ?? null,
    critiqueError: partial?.critiqueError ?? (history.length > 0 ? undefined : 'the seat threw before producing a critique'),
    critiqueRaw: partial?.critiqueRaw,
    setupCapped: partial?.setupCapped,
    coverage: partial?.coverage ?? computeCoverage(history),
    verifiers: partial?.verifiers ?? runVerifiers(history),
    panel: partial?.panel ?? null,
    durationMs: partial?.durationMs ?? 0,
    dir: partial?.dir ?? trySeatDir(cfg, opts.label, seat),
  };
}

/**
 * Serial rpc: one Driver, start once, reset() between seats, stop once.
 * Missing or throwing reset fails that next seat (no silent second client).
 * Parallel rpc stays one process per seat — the paste-and-go bridge is single-client.
 */
async function runSerialRpc(
  cfg: PlaytestConfig,
  seats: Seat[],
  opts: RunOptions,
): Promise<SeatResult[]> {
  if (seats.length === 0) return [];
  const env = resolveEnv(cfg.game.env, opts.env ?? process.env);
  const makeDriver = opts.makeDriver
    ?? (opts.spawn ? async (c: PlaytestConfig, e: Record<string, string>) => createStdioDriver({ game: c.game, env: e, spawn: opts.spawn }) : createDriver);

  let driver: Driver | undefined;
  const out: SeatResult[] = [];
  try {
    let game: Driver;
    try {
      game = await makeDriver(cfg, env);
      driver = game;
    } catch (err) {
      const msg = formatErr(err);
      return seats.map((s) => failedSeat(cfg, s, opts, msg));
    }
    let firstObs: Observation;
    try {
      firstObs = await game.start();
    } catch (err) {
      const msg = formatErr(err);
      return seats.map((s) => failedSeat(cfg, s, opts, msg));
    }

    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i];
      let initial: Observation;
      if (i === 0) {
        initial = firstObs;
      } else if (typeof game.reset !== 'function') {
        out.push(failedSeat(
          cfg,
          seat,
          opts,
          'E_RESET: rpc driver has no reset(); serial panel reuse cannot start a second client — launch one process per seat or implement Driver.reset',
        ));
        continue;
      } else {
        try {
          initial = await game.reset();
        } catch (err) {
          out.push(failedSeat(cfg, seat, opts, `E_RESET: driver.reset() failed: ${formatErr(err)}`));
          continue;
        }
      }
      try {
        out.push(await runSeat(cfg, seat, {
          ...opts,
          sharedDriver: game,
          initialObservation: initial,
          manageLifecycle: false,
        }));
      } catch (err) {
        out.push(settleRejectedSeat(cfg, seat, opts, err));
      }
    }
    return out;
  } finally {
    if (driver) {
      try {
        await driver.stop();
      } catch (err) {
        const stopError = formatErr(err);
        const last = out[out.length - 1];
        if (last && !last.stopError) last.stopError = stopError;
      }
    }
  }
}

export async function runAll(cfg: PlaytestConfig, opts: RunOptions & { seats?: string[]; parallel?: boolean }): Promise<SeatResult[]> {
  const seats = opts.seats && opts.seats.length > 0 ? cfg.seats.filter((s) => opts.seats!.includes(s.id)) : cfg.seats;
  if (opts.parallel === false) {
    if (cfg.driver.kind === 'rpc') return runSerialRpc(cfg, seats, opts);
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
    out.push(settleRejectedSeat(cfg, seats[i], opts, r.reason));
  });
  return out;
}
