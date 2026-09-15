#!/usr/bin/env node
// cli.ts — `ai-playtest run <config.json> [--label x] [--seats a,b] [--turns n] [--serial]`
//          `ai-playtest report <config.json> --label x`
// Exit codes: 0 ok, 1 usage, 2 config, 3 provider, 4 run error.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, ConfigError } from './config.js';
import { createOpenRouterClient, OpenRouterError } from './openrouter.js';
import { runAll } from './run.js';
import { writeReport } from './report.js';

function usage(): string {
  return [
    'ai-playtest -- family-diverse AI playtesting for text games',
    '',
    'Usage:',
    '  ai-playtest run <config.json> [--label <name>] [--seats a,b] [--turns <n>] [--serial]',
    '  ai-playtest report <config.json> --label <name>',
    '',
    'Env: OPENROUTER_API_KEY (players and critics). The game\'s own env comes from config.game.env.',
    'Runs land under <config.runsDir>/<label>/<seat>/ with transcript.txt, critique.json, meta.json; REPORT.md at the label root.',
  ].join('\n');
}

function fail(code: number, message: string, hint?: string): never {
  process.stderr.write(`error: ${message}\n${hint ? `hint: ${hint}\n` : ''}`);
  process.exit(code);
}

/**
 * Read `--name value`. Returns undefined when the flag is absent; throws when it
 * is present but its value is missing or is itself another flag — `--turns
 * --serial` used to silently read "--serial" as the turn count.
 */
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(1, `${name} needs a value`, `you wrote "${name}${value ? ` ${value}` : ''}"`);
  }
  return value;
}

/** A turn budget has to be a positive whole number; Number("abc") is NaN. */
function parseTurns(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    fail(2, `--turns must be a positive whole number, got "${raw}"`, 'e.g. --turns 40');
  }
  return n;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verb = args[0];
  if (!verb || verb === '--help' || verb === '-h') { process.stdout.write(usage() + '\n'); process.exit(verb ? 0 : 1); }
  const configPath = args[1];
  if (!configPath) fail(1, `${verb} needs a config path`, usage());
  let cfg;
  try {
    cfg = await loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) fail(2, err.message, err.hint);
    throw err;
  }
  const label = flag(args, '--label') ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (verb === 'report') {
    // Without this the label defaulted to "now", and rebuilding a report read a
    // directory that cannot exist, surfacing as a raw ENOENT rather than a
    // coded error naming the real problem.
    if (!flag(args, '--label')) fail(1, 'report needs --label', 'name the run to rebuild, e.g. --label phase9');
    const runDir = join(cfg.runsDir, label);
    if (!existsSync(runDir)) fail(2, `no run at ${runDir}`, 'check --label, or run the playtest first');
    const path = await writeReport(cfg.name, runDir, label, cfg.criteria.map((c) => c.id));
    process.stdout.write(`wrote ${path}\n`);
    return;
  }
  if (verb !== 'run') fail(1, `unknown verb ${verb}`, usage());

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) fail(3, 'OPENROUTER_API_KEY is not set', 'export it; players and critics are OpenRouter seats');
  const turns = flag(args, '--turns');
  if (turns) cfg.turns = parseTurns(turns);
  const seats = flag(args, '--seats')?.split(',').map((s) => s.trim()).filter(Boolean);
  const client = createOpenRouterClient({ apiKey });

  process.stdout.write(`${cfg.name}: ${(seats ?? cfg.seats.map((s) => s.id)).join(', ')} × ${cfg.turns} turns → ${join(cfg.runsDir, label)}\n`);
  try {
    const results = await runAll(cfg, {
      label, client, seats, parallel: !args.includes('--serial'),
      onTurn: (seat, t) => process.stdout.write(`  [${seat.id}] t${t.turn} (${t.reason}, ${t.ms}ms) > ${t.input}\n`),
      onSeatDone: (r) => process.stdout.write(`  [${r.seat.id}] done: ${r.turnsPlayed} turns, ended by ${r.endedBy}${r.error ? ` (${r.error})` : ''}, critique ${r.critique ? (r.critique.alive ? 'ALIVE' : 'not alive') : `failed (${r.critiqueError})`}\n`),
    });
    const path = await writeReport(cfg.name, join(cfg.runsDir, label), label, cfg.criteria.map((c) => c.id));
    const failed = results.filter((r) => r.endedBy === 'error');
    process.stdout.write(`report: ${path}\n`);
    if (failed.length === results.length) fail(4, 'every seat failed', failed[0]?.error);
  } catch (err) {
    if (err instanceof OpenRouterError) fail(3, err.message, err.hint);
    if (err instanceof ConfigError) fail(2, err.message, err.hint);
    throw err;
  }
}

main().catch((err) => fail(4, err instanceof Error ? err.message : String(err)));
