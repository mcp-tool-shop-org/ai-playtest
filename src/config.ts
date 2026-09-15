// config.ts — the playtest config: which game to spawn, which model seats play it,
// how the player and critic are briefed, and how the runner tells "the game is
// waiting for input" from "the game is still printing".

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

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

export function validateConfig(raw: unknown, baseDir: string): PlaytestConfig {
  if (!raw || typeof raw !== 'object') throw new ConfigError('config is not an object', 'the file must hold one JSON object');
  const c = raw as Record<string, unknown>;
  const game = c.game as Record<string, unknown> | undefined;
  if (!c.name || typeof c.name !== 'string') throw new ConfigError('name missing', 'give the playtest a name');
  if (!game || typeof game.command !== 'string' || !Array.isArray(game.args)) throw new ConfigError('game.command / game.args missing', 'game.command is the executable, game.args its arguments');
  if (!Array.isArray(game.promptPatterns) || game.promptPatterns.length === 0) throw new ConfigError('game.promptPatterns missing', 'list at least one regex that matches the game\'s input prompt');
  if (!Array.isArray(c.seats) || c.seats.length === 0) throw new ConfigError('seats missing', 'list at least one { id, family, model }');
  const families = new Set<string>();
  for (const s of c.seats as Seat[]) {
    if (!s.id || !s.family || !s.model) throw new ConfigError(`seat ${JSON.stringify(s)} incomplete`, 'each seat needs id, family, model');
    if (families.has(s.family)) throw new ConfigError(`family ${s.family} seated twice`, 'one seat per family -- diversity is the point');
    families.add(s.family);
  }
  if (typeof c.persona !== 'string' || c.persona.length < 20) throw new ConfigError('persona missing', 'brief the player: goals and register, not mechanics');
  if (!Array.isArray(c.criteria) || c.criteria.length === 0) throw new ConfigError('criteria missing', 'list the game\'s own "alive" criteria as { id, check }');
  for (const p of game.promptPatterns as string[]) {
    try { new RegExp(p); } catch { throw new ConfigError(`promptPattern ${p} is not a valid regex`, 'fix the pattern'); }
  }
  const setup = Array.isArray(c.setup) ? (c.setup as SetupStep[]) : [];
  for (const st of setup) {
    if (typeof st.match !== 'string' || typeof st.answer !== 'string') throw new ConfigError(`setup step ${JSON.stringify(st)} incomplete`, 'each setup step needs { match, answer }');
    try { new RegExp(st.match); } catch { throw new ConfigError(`setup match ${st.match} is not a valid regex`, 'fix the pattern'); }
  }
  return {
    name: c.name,
    game: {
      command: game.command as string,
      args: game.args as string[],
      cwd: typeof game.cwd === 'string' ? resolve(baseDir, game.cwd) : baseDir,
      env: (game.env as Record<string, string>) ?? {},
      inheritEnv: game.inheritEnv === true,
      promptPatterns: game.promptPatterns as string[],
      promptQuietMs: (game.promptQuietMs as number) ?? DEFAULTS.game.promptQuietMs,
      idleQuietMs: (game.idleQuietMs as number) ?? DEFAULTS.game.idleQuietMs,
      screenTimeoutMs: (game.screenTimeoutMs as number) ?? DEFAULTS.game.screenTimeoutMs,
      quitInputs: (game.quitInputs as string[]) ?? DEFAULTS.game.quitInputs,
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
