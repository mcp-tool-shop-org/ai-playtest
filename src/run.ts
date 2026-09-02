// run.ts — one seat: spawn the game, let the model play N turns, quit, critique,
// write the artifacts. All seats: in parallel, each in its own directory.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlaytestConfig, Seat } from './config.js';
import { resolveEnv } from './config.js';
import type { ChatClient } from './openrouter.js';
import { spawnGame, type GameProcess } from './stdio-game.js';
import { chooseInput, type TurnRecord } from './player.js';
import { critique, type Critique } from './critic.js';

export type SeatResult = {
  seat: Seat;
  label: string;
  turnsPlayed: number;
  endedBy: 'turns' | 'exit' | 'timeout' | 'error';
  error?: string;
  history: TurnRecord[];
  critique: Critique | null;
  critiqueError?: string;
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

export function seatDir(cfg: PlaytestConfig, label: string, seat: Seat): string {
  return join(cfg.runsDir, label, seat.id);
}

export async function runSeat(cfg: PlaytestConfig, seat: Seat, opts: RunOptions): Promise<SeatResult> {
  const started = Date.now();
  const dir = seatDir(cfg, opts.label, seat);
  await mkdir(dir, { recursive: true });
  const env = resolveEnv(cfg.game.env, opts.env ?? process.env);
  const game: GameProcess = (opts.spawn ?? spawnGame)(cfg.game, env);
  const history: TurnRecord[] = [];
  let endedBy: SeatResult['endedBy'] = 'turns';
  let error: string | undefined;
  let turn = 0;
  const setupSteps = cfg.setup.map((st) => ({ re: new RegExp(st.match, 'm'), answer: st.answer }));
  let setupAnswers = 0;
  const MAX_SETUP_ANSWERS = 60;
  try {
    while (turn < cfg.turns) {
      const t0 = Date.now();
      const screen = await game.nextScreen();
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
        game.send(step.answer);
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
      game.send(input);
    }
    // Quit sequence: every screen the game prints from here on is still
    // evidence (the last input's consequences, the save recap), so it is
    // recorded like a turn, with the quit input as the reply.
    if (!game.exited) {
      for (const q of cfg.game.quitInputs) {
        const t0 = Date.now();
        const screen = await game.nextScreen();
        if (screen.reason === 'exit' || screen.reason === 'timeout') { history.push({ turn: turn + 1, screen: screen.text, input: '', reason: screen.reason, ms: Date.now() - t0 }); break; }
        turn++;
        history.push({ turn, screen: screen.text, input: q, reason: screen.reason, ms: Date.now() - t0 });
        game.send(q);
      }
      const final = await game.nextScreen();
      if (final.text.trim().length > 0) history.push({ turn: turn + 1, screen: final.text, input: '', reason: final.reason, ms: 0 });
    }
  } catch (err) {
    endedBy = 'error';
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  } finally {
    game.kill();
  }

  let crit: Critique | null = null;
  let critiqueError: string | undefined;
  const played = history.filter((h) => h.input.length > 0 && h.reason !== 'setup');
  if (played.length > 0) {
    try {
      crit = await critique(opts.client, seat.model, cfg.criteria, played);
    } catch (err) {
      critiqueError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }

  const result: SeatResult = {
    seat, label: opts.label, turnsPlayed: turn, endedBy, error, history, critique: crit, critiqueError,
    durationMs: Date.now() - started, dir,
  };
  await writeArtifacts(cfg, result, game.stderr);
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
    error: r.error ?? null, critiqueError: r.critiqueError ?? null, durationMs: r.durationMs, finishedAt: new Date().toISOString(),
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
  return Promise.all(seats.map((s) => runSeat(cfg, s, opts)));
}
