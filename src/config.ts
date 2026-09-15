// config.ts — the playtest config: which game to spawn, which model seats play it,
// how the player and critic are briefed, and how the runner tells "the game is
// waiting for input" from "the game is still printing".

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { DEFAULT_VERIFIERS, type VerifierConfig } from './verifiers.js';

export type Seat = {
  /** Short id, used for the run directory (e.g. "mistral"). */
  id: string;
  /** Model family, for the report (e.g. "mistral"). Two seats never share one. */
  family: string;
  /** OpenRouter model slug (e.g. "mistralai/mistral-small-3.2-24b-instruct"). */
  model: string;
};

export type GameConfig = {
  /** Executable (e.g. "node"). */
  command: string;
  args: string[];
  /** Working directory, resolved against the config file's directory. */
  cwd?: string;
  /** Extra environment for the game process; values starting with "$" read the runner's env. */
  env?: Record<string, string>;
  /**
   * Pass the runner's ENTIRE environment to the game, rather than a minimal
   * allowlist plus `env`. Off by default: the game under test is arbitrary code
   * and inheriting everything hands it `OPENROUTER_API_KEY`. Turn it on only for
   * a game you trust as much as the runner itself.
   */
  inheritEnv?: boolean;
  /**
   * Regexes (source strings) that, when the stripped stdout tail matches one,
   * mean the game is waiting for a line. Checked after `promptQuietMs` of
   * silence; without a match the runner waits `idleQuietMs` instead.
   */
  promptPatterns: string[];
  /** Silence (ms) after a prompt-pattern match before the screen is handed to the player. */
  promptQuietMs: number;
  /** Silence (ms) with no prompt match before the runner assumes the game waits anyway. */
  idleQuietMs: number;
  /** Hard cap (ms) on one screen; the turn is recorded as a stall and the seat ends. */
  screenTimeoutMs: number;
  /** Lines the runner sends to end the game cleanly after the last turn. */
  quitInputs: string[];
};

/**
 * Which observation channel to drive the game through.
 *
 * `stdio` is the original: spawn it, read lines, guess when it is waiting.
 * `pty` gives it a real terminal and reads the rendered SCREEN, which is what a
 * full-screen TUI needs and what makes prompt detection sound (under a pipe a
 * C program's stdout is fully buffered, so "quiet" can mean "has not flushed").
 * `rpc` connects to a game that describes itself over the engine bridge — the
 * strongest channel, and the only one that works with no terminal at all.
 */
export type DriverConfig =
  | { kind: 'stdio' }
  | { kind: 'pty'; cols?: number; rows?: number; readySentinel?: string }
  | { kind: 'rpc'; host?: string; port: number; connectTimeoutMs?: number; requestTimeoutMs?: number };

export type Criterion = { id: string; check: string };

/**
 * A scripted answer for a setup prompt (character creation, menus): when the
 * stripped screen tail matches `match`, the runner sends `answer` itself,
 * without asking the player and without spending a turn. Every seat then
 * starts from the same character, which is the fair way to compare families.
 */
export type SetupStep = { match: string; answer: string };

export type PlaytestConfig = {
  name: string;
  game: GameConfig;
  /** Which observation channel to use. Defaults to stdio, so existing configs are unaffected. */
  driver: DriverConfig;
  seats: Seat[];
  /** Inputs each seat sends while the game is waiting -- setup prompts (name, menus) count, so budget for them. */
  turns: number;
  /** Scripted setup answers, checked before the player is asked (see SetupStep). */
  setup: SetupStep[];
  /** The player brief: goals and register, never the mechanics under test. */
  persona: string;
  /** The critic's rubric: the game's own "alive" criteria plus free-form findings. */
  criteria: Criterion[];
  /** Characters of screen kept per turn in the player's context window. */
  screenChars: number;
  /** How many recent turns the player sees. */
  playerMemoryTurns: number;
  /** Where runs are written, resolved against the config file's directory. */
  runsDir: string;
  /** Sampling temperature for the player; the critic always runs at 0. */
  playerTemperature: number;
  /**
   * How many cross-family jurors judge each transcript. Default 1: a second
   * family is required so the author is not scoring itself, but extra jurors
   * buy almost no independence (Kohli 2026 Kish n_eff 2.18 across 7 families).
   * Raise this to flag disagreement, not to average into a stronger score.
   */
  panelSize: number;
  /** Deterministic transcript checks. Empty regex lists mean "do not guess". */
  verifiers: VerifierConfig;
};

export class ConfigError extends Error {
  readonly code = 'E_CONFIG';
  constructor(message: string, readonly hint: string) {
    super(message);
  }
}

const DEFAULTS = {
  turns: 40,
  screenChars: 6000,
  playerMemoryTurns: 8,
  runsDir: 'runs',
  playerTemperature: 0.7,
  // Default 1: Kohli 2026 measured a 3-judge cross-family panel at n_eff ~1.68
  // and no accuracy gain over the best single judge. Author-off-jury is a
  // different claim (Panickssery/Stechly) and still holds at panelSize 1.
  panelSize: 1,
  game: { promptQuietMs: 800, idleQuietMs: 6000, screenTimeoutMs: 180_000, quitInputs: ['quit'] },
};

export function resolveEnv(env: Record<string, string> | undefined, source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    if (v.startsWith('$')) {
      const name = v.slice(1);
      const value = source[name];
      if (value === undefined) throw new ConfigError(`env ${k} reads $${name}, which is not set`, `export ${name} before running`);
      out[k] = value;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function validateDriver(raw: unknown): DriverConfig {
  if (raw === undefined || raw === null) return { kind: 'stdio' };
  if (typeof raw !== 'object') throw new ConfigError('driver must be an object', 'e.g. { "kind": "pty" } or { "kind": "rpc", "port": 7777 }');
  const d = raw as Record<string, unknown>;
  const kind = d.kind;
  if (kind === 'stdio' || kind === undefined) return { kind: 'stdio' };
  if (kind === 'pty') {
    return {
      kind: 'pty',
      cols: typeof d.cols === 'number' ? d.cols : undefined,
      rows: typeof d.rows === 'number' ? d.rows : undefined,
      readySentinel: typeof d.readySentinel === 'string' ? d.readySentinel : undefined,
    };
  }
  if (kind === 'rpc') {
    if (typeof d.port !== 'number' || !Number.isInteger(d.port) || d.port <= 0 || d.port > 65535) {
      throw new ConfigError('driver.port must be a TCP port number', 'e.g. { "kind": "rpc", "port": 7777 } -- see docs/engine-bridge.md');
    }
    return {
      kind: 'rpc',
      host: typeof d.host === 'string' ? d.host : undefined,
      port: d.port,
      connectTimeoutMs: typeof d.connectTimeoutMs === 'number' ? d.connectTimeoutMs : undefined,
      requestTimeoutMs: typeof d.requestTimeoutMs === 'number' ? d.requestTimeoutMs : undefined,
    };
  }
  throw new ConfigError(`unknown driver kind "${String(kind)}"`, 'driver.kind must be one of: stdio, pty, rpc');
}

export function validateConfig(raw: unknown, baseDir: string): PlaytestConfig {
  if (!raw || typeof raw !== 'object') throw new ConfigError('config is not an object', 'the file must hold one JSON object');
  const c = raw as Record<string, unknown>;
  const game = c.game as Record<string, unknown> | undefined;
  if (!c.name || typeof c.name !== 'string') throw new ConfigError('name missing', 'give the playtest a name');
  const driver = validateDriver(c.driver);
  // The rpc driver attaches to an already-running game, so it needs no command
  // to spawn and no prompt pattern to watch for -- the game says when it is
  // ready. Every other driver needs both.
  const spawnsGame = driver.kind !== 'rpc';
  if (spawnsGame) {
    if (!game || typeof game.command !== 'string' || !Array.isArray(game.args)) throw new ConfigError('game.command / game.args missing', 'game.command is the executable, game.args its arguments');
    if (!Array.isArray(game.promptPatterns) || game.promptPatterns.length === 0) throw new ConfigError('game.promptPatterns missing', 'list at least one regex that matches the game\'s input prompt');
  }
  if (!Array.isArray(c.seats) || c.seats.length === 0) throw new ConfigError('seats missing', 'list at least one { id, family, model }');
  const families = new Set<string>();
  for (const s of c.seats as Seat[]) {
    if (!s.id || !s.family || !s.model) throw new ConfigError(`seat ${JSON.stringify(s)} incomplete`, 'each seat needs id, family, model');
    if (families.has(s.family)) throw new ConfigError(`family ${s.family} seated twice`, 'one seat per family -- diversity is the point');
    families.add(s.family);
  }
  if (typeof c.persona !== 'string' || c.persona.length < 20) throw new ConfigError('persona missing', 'brief the player: goals and register, not mechanics');
  if (!Array.isArray(c.criteria) || c.criteria.length === 0) throw new ConfigError('criteria missing', 'list the game\'s own "alive" criteria as { id, check }');
  for (const p of ((game?.promptPatterns as string[]) ?? [])) {
    try { new RegExp(p); } catch { throw new ConfigError(`promptPattern ${p} is not a valid regex`, 'fix the pattern'); }
  }
  const setup = Array.isArray(c.setup) ? (c.setup as SetupStep[]) : [];
  for (const st of setup) {
    if (typeof st.match !== 'string' || typeof st.answer !== 'string') throw new ConfigError(`setup step ${JSON.stringify(st)} incomplete`, 'each setup step needs { match, answer }');
    try { new RegExp(st.match); } catch { throw new ConfigError(`setup match ${st.match} is not a valid regex`, 'fix the pattern'); }
  }
  return {
    name: c.name,
    driver,
    game: {
      command: (game?.command as string) ?? '',
      args: (game?.args as string[]) ?? [],
      cwd: typeof game?.cwd === 'string' ? resolve(baseDir, game.cwd as string) : baseDir,
      env: (game?.env as Record<string, string>) ?? {},
      inheritEnv: game?.inheritEnv === true,
      promptPatterns: (game?.promptPatterns as string[]) ?? [],
      promptQuietMs: (game?.promptQuietMs as number) ?? DEFAULTS.game.promptQuietMs,
      idleQuietMs: (game?.idleQuietMs as number) ?? DEFAULTS.game.idleQuietMs,
      screenTimeoutMs: (game?.screenTimeoutMs as number) ?? DEFAULTS.game.screenTimeoutMs,
      quitInputs: (game?.quitInputs as string[]) ?? DEFAULTS.game.quitInputs,
    },
    seats: c.seats as Seat[],
    setup,
    turns: (c.turns as number) ?? DEFAULTS.turns,
    persona: c.persona,
    criteria: c.criteria as Criterion[],
    screenChars: (c.screenChars as number) ?? DEFAULTS.screenChars,
    playerMemoryTurns: (c.playerMemoryTurns as number) ?? DEFAULTS.playerMemoryTurns,
    runsDir: resolve(baseDir, (c.runsDir as string) ?? DEFAULTS.runsDir),
    playerTemperature: (c.playerTemperature as number) ?? DEFAULTS.playerTemperature,
    panelSize: typeof c.panelSize === 'number' && c.panelSize >= 0 ? c.panelSize : DEFAULTS.panelSize,
    verifiers: validateVerifiers(c.verifiers),
  };
}

function strList(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
}

export function validateVerifiers(raw: unknown): VerifierConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_VERIFIERS };
  if (typeof raw !== 'object') throw new ConfigError('verifiers must be an object', 'omit it to use empty regex lists and the occupancy defaults');
  const v = raw as Record<string, unknown>;
  for (const key of ['unparsed', 'refused', 'victory', 'death'] as const) {
    for (const src of strList(v[key])) {
      try { new RegExp(src); } catch { throw new ConfigError(`verifiers.${key} entry ${src} is not a valid regex`, 'fix the pattern'); }
    }
  }
  return {
    absorbingMinTurns: typeof v.absorbingMinTurns === 'number' && v.absorbingMinTurns > 0 ? v.absorbingMinTurns : DEFAULT_VERIFIERS.absorbingMinTurns,
    noProgressWindow: typeof v.noProgressWindow === 'number' && v.noProgressWindow > 1 ? v.noProgressWindow : DEFAULT_VERIFIERS.noProgressWindow,
    noOpVerbs: strList(v.noOpVerbs),
    unparsed: strList(v.unparsed),
    refused: strList(v.refused),
    victory: strList(v.victory),
    death: strList(v.death),
  };
}

export async function loadConfig(path: string): Promise<PlaytestConfig> {
  const abs = resolve(path);
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read ${abs}: ${(err as Error).message}`, 'pass the path to a playtest config JSON');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${abs} is not valid JSON: ${(err as Error).message}`, 'fix the JSON');
  }
  return validateConfig(raw, dirname(abs));
}
