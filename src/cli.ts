#!/usr/bin/env node
// cli.ts — `ai-playtest run <config.json> [--label x] [--seats a,b] [--turns n] [--serial]`
//          `ai-playtest report <config.json> --label x`
// Exit codes: 0 ok, 1 usage, 2 config, 3 provider, 4 run error.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { loadConfig, ConfigError } from './config.js';
import { createOpenRouterClient, OpenRouterError } from './openrouter.js';
import { runAll } from './run.js';
import { writeReport, writeAggregateReport } from './report.js';
import { summarizeRuns } from './stats.js';

function usage(): string {
  return [
    'ai-playtest -- family-diverse AI playtesting for text games',
    '',
    'Usage:',
    '  ai-playtest run <config.json> [--label <name>] [--seats a,b] [--turns <n>] [--runs <n>] [--serial]',
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

function parseRuns(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    fail(2, `--runs must be a positive whole number, got "${raw}"`, 'e.g. --runs 3');
  }
  return n;
}

function criterionMetInRun(results: Array<{ panel?: { criteria: Array<{ id: string; met: boolean }> } | null; critique?: { criteria: Array<{ id: string; met: boolean }> } | null }>, id: string): boolean {
  const votes = results.map((r) => {
    const row = r.panel?.criteria.find((c) => c.id === id) ?? r.critique?.criteria.find((c) => c.id === id);
    return row?.met ?? false;
  });
  return votes.filter(Boolean).length * 2 > votes.length;
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
  const runsFlag = flag(args, '--runs');
  const runCount = runsFlag ? parseRuns(runsFlag) : 1;
  const seats = flag(args, '--seats')?.split(',').map((s) => s.trim()).filter(Boolean);
  const client = createOpenRouterClient({ apiKey });

  process.stdout.write(`${cfg.name}: ${(seats ?? cfg.seats.map((s) => s.id)).join(', ')} × ${cfg.turns} turns × ${runCount} run${runCount === 1 ? '' : 's'} → ${join(cfg.runsDir, label)}\n`);
  if (runCount !== 1) process.stdout.write(`${summarizeRuns([], runCount).warning}\n`);
  const onTurn = (seat: { id: string }, t: { turn: number; reason: string; ms: number; input: string }) =>
    process.stdout.write(`  [${seat.id}] t${t.turn} (${t.reason}, ${t.ms}ms) > ${t.input}\n`);
  const onSeatDone = (r: { seat: { id: string }; turnsPlayed: number; endedBy: string; error?: string; critique: { alive: boolean } | null; critiqueError?: string; panel: { alive: boolean; jurors: unknown[] } | null }) =>
    process.stdout.write(`  [${r.seat.id}] done: ${r.turnsPlayed} turns, ended by ${r.endedBy}${r.error ? ` (${r.error})` : ''}, ${r.panel ? `jury ${r.panel.alive ? 'ALIVE' : 'not alive'} (${r.panel.jurors.length} juror${r.panel.jurors.length === 1 ? '' : 's'})` : r.critique ? `critique ${r.critique.alive ? 'ALIVE' : 'not alive'} (testimony)` : `failed (${r.critiqueError})`}\n`);
  try {
    const criterionIds = cfg.criteria.map((c) => c.id);
    if (runCount === 1) {
      const results = await runAll(cfg, {
        label, client, seats, parallel: !args.includes('--serial'), onTurn, onSeatDone,
      });
      const path = await writeReport(cfg.name, join(cfg.runsDir, label), label, criterionIds);
      const failed = results.filter((r) => r.endedBy === 'error');
      process.stdout.write(`report: ${path}\n`);
      if (failed.length === results.length) fail(4, 'every seat failed', failed[0]?.error);
    } else {
      const successes = Object.fromEntries(criterionIds.map((id) => [id, 0]));
      const worstOfN: Array<{ run: string; alive: number; of: number }> = [];
      let anyOk = false;
      for (let i = 1; i <= runCount; i++) {
        const runLabel = `${label}-r${String(i).padStart(2, '0')}`;
        process.stdout.write(`-- run ${i}/${runCount} (${runLabel})\n`);
        const results = await runAll(cfg, {
          label: runLabel, client, seats, parallel: !args.includes('--serial'), onTurn, onSeatDone,
        });
        await writeReport(cfg.name, join(cfg.runsDir, runLabel), runLabel, criterionIds);
        const failed = results.filter((r) => r.endedBy === 'error');
        if (failed.length < results.length) anyOk = true;
        for (const id of criterionIds) if (criterionMetInRun(results, id)) successes[id]++;
        const alive = results.filter((r) => (r.panel ? r.panel.alive : r.critique?.alive) === true).length;
        worstOfN.push({ run: runLabel, alive, of: results.length });
      }
      await mkdir(join(cfg.runsDir, label), { recursive: true });
      const path = await writeAggregateReport(
        cfg.name, join(cfg.runsDir, label), label, runCount,
        criterionIds.map((id) => ({ id, successes: successes[id] })),
        worstOfN,
      );
      process.stdout.write(`aggregate: ${path}\n`);
      if (!anyOk) fail(4, 'every seat failed in every run');
    }
  } catch (err) {
    if (err instanceof OpenRouterError) fail(3, err.message, err.hint);
    if (err instanceof ConfigError) fail(2, err.message, err.hint);
    throw err;
  }
}

main().catch((err) => fail(4, err instanceof Error ? err.message : String(err)));
