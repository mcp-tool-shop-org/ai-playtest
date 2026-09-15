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

export type SeatResult = {
  seat: Seat;
  label: string;
  turnsPlayed: number;
  endedBy: 'turns' | 'exit' | 'timeout' | 'error';
  error?: string;
  history: TurnRecord[];
  critique: Critique | null;
  critiqueError?: string;
  /** How much of the game this session actually saw. Computed from the turn records. */
  coverage: Coverage;
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
  onSeatDone?: (r: SeatResult) => void;
};

async function withTurnRetries<T>(fn: () => Promise<T>, retries: number, sleepMs: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, sleepMs));
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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

export async function runSeat(cfg: PlaytestConfig, seat: Seat, opts: RunOptions): Promise<SeatResult> {
  const started = Date.now();
  const dir = seatDir(cfg, opts.label, seat);
  await mkdir(dir, { recursive: true });
  const env = resolveEnv(cfg.game.env, opts.env ?? process.env);
  const makeDriver = opts.makeDriver
    ?? (opts.spawn ? async (c: PlaytestConfig, e: Record<string, string>) => createStdioDriver({ game: c.game, env: e, spawn: opts.spawn }) : createDriver);
  const driver: Driver = await makeDriver(cfg, env);
  const history: TurnRecord[] = [];
  let pendingScreen: Observation | null = await driver.start();
  let endedBy: SeatResult['endedBy'] = 'turns';
  let error: string | undefined;
  let turn = 0;
  const setupSteps = cfg.setup.map((st) => ({ re: new RegExp(st.match, 'm'), answer: st.answer }));
  let setupAnswers = 0;
  const MAX_SETUP_ANSWERS = 60;
  try {
    while (turn < cfg.turns) {
      const t0 = Date.now();
      const screen = pendingScreen ?? await driver.step({ kind: 'line', line: '' });
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
        pendingScreen = await driver.step({ kind: 'line', line: step.answer });
        continue;
      }
      // A player call can fail after the client's own retries (a provider
      // outage lasting minutes); the turn waits and tries again a few times
      // before the seat ends, so one bad minute does not void a session.
      const input = await withTurnRetries(() => chooseInput(opts.client, seat.model, cfg.persona, history, screen.text, {
        memoryTurns: cfg.playerMemoryTurns,
        screenChars: cfg.screenChars,
        temperature: cfg.playerTemperature,
      }), opts.turnRetries ?? 3, opts.turnRetrySleepMs ?? 30_000);
      turn++;
      const rec: TurnRecord = { turn, screen: screen.text, input, reason: screen.reason, ms: Date.now() - t0 };
      history.push(rec);
      opts.onTurn?.(seat, rec);
      pendingScreen = await driver.step({ kind: 'line', line: input });
    }
    // Quit sequence: every screen the game prints from here on is still
    // evidence (the last input's consequences, the save recap), so it is
    // recorded like a turn, with the quit input as the reply.
    if (!(pendingScreen?.done ?? false)) {
      for (const q of cfg.game.quitInputs) {
        const t0 = Date.now();
        const screen = pendingScreen ?? await driver.step({ kind: 'line', line: '' });
        pendingScreen = null;
        if (screen.reason === 'exit' || screen.reason === 'timeout') { history.push({ turn, screen: screen.text, input: '', reason: screen.reason, ms: Date.now() - t0 }); break; }
        // Marked 'quit' and NOT counted as a player turn. These are the
        // runner's own inputs; counting them inflated turnsPlayed and, worse,
        // presented them to the critic as decisions the player made.
        history.push({ turn, screen: screen.text, input: q, reason: 'quit', ms: Date.now() - t0 });
        pendingScreen = await driver.step({ kind: 'line', line: q });
      }
      const final = pendingScreen ?? await driver.step({ kind: 'line', line: '' });
      pendingScreen = null;
      if (final.text.trim().length > 0) history.push({ turn, screen: final.text, input: '', reason: final.reason, ms: 0 });
    }
  } catch (err) {
    endedBy = 'error';
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  } finally {
    await driver.stop();
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
      critiqueError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    // The score comes from families that did not write this transcript.
    const jurors = pickJurors(cfg.seats, seat, cfg.panelSize);
    if (jurors.length > 0) {
      const critiques = await Promise.all(jurors.map(async (juror) => {
        try {
          return { seat: juror, critique: await critique(opts.client, juror.model, cfg.criteria, evidence, { outcome }) };
        } catch (err) {
          return { seat: juror, critique: null, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
        }
      }));
      panel = aggregatePanel(jurors, critiques, cfg.criteria);
    }
  } else {
    // A session where the player never moved used to produce a full, confident
    // verdict over a transcript containing only the runner's own quit input.
    critiqueError = `no player turns were taken (ended by ${endedBy}); nothing to judge`;
    if (endedBy === 'turns') endedBy = 'error';
    error = error ?? 'the player took no turns';
  }

  const result: SeatResult = {
    seat, label: opts.label, turnsPlayed: playerTurns.length, endedBy, error, history, critique: crit, critiqueError,
    coverage: computeCoverage(history),
    panel,
    durationMs: Date.now() - started, dir,
  };
  await writeArtifacts(cfg, result, driver.diagnostics);
  opts.onSeatDone?.(result);
  return result;
}

async function writeArtifacts(cfg: PlaytestConfig, r: SeatResult, stderr: string): Promise<void> {
  const lines: string[] = [
    `# ai-playtest transcript -- ${cfg.name} -- seat ${r.seat.id} (${r.seat.family}: ${r.seat.model}) -- label ${r.label}`,
    `# turns ${r.turnsPlayed}, ended by ${r.endedBy}${r.error ? `, error: ${r.error}` : ''}, ${Math.round(r.durationMs / 1000)}s`,
    '',
  ];
  for (const t of r.history) {
    lines.push(t.reason === 'setup' ? `═══ setup ── screen (${t.ms}ms)` : `═══ turn ${t.turn} ── screen (${t.reason}, ${t.ms}ms)`);
    lines.push(t.screen.trimEnd());
    if (t.input) lines.push(`> ${t.input}`);
    lines.push('');
  }
  await writeFile(join(r.dir, 'transcript.txt'), lines.join('\n') + '\n', 'utf8');
  await writeFile(join(r.dir, 'critique.json'), JSON.stringify(r.critique ?? { error: r.critiqueError ?? 'no turns played' }, null, 2) + '\n', 'utf8');
  await writeFile(join(r.dir, 'meta.json'), JSON.stringify({
    name: cfg.name, label: r.label, seat: r.seat, turns: cfg.turns, turnsPlayed: r.turnsPlayed, endedBy: r.endedBy,
    error: r.error ?? null, critiqueError: r.critiqueError ?? null, coverage: r.coverage, panel: r.panel,
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
    out.push({
      seat, label: opts.label, turnsPlayed: 0, endedBy: 'error',
      error: r.reason instanceof Error ? `${r.reason.name}: ${r.reason.message}` : String(r.reason),
      history: [], critique: null, critiqueError: 'the seat threw before producing a critique',
      coverage: computeCoverage([]),
      panel: null,
      durationMs: 0, dir: join(cfg.runsDir, opts.label, seat.id),
    });
  });
  return out;
}
