#!/usr/bin/env node
// cli.ts — `ai-playtest run <config.json> [--label x] [--seats a,b] [--turns n] [--runs n] [--serial] [--profile p] [--personas a,b]`
//          `ai-playtest report <config.json> --label x`
//          `ai-playtest score <config.json> --label x`
//          `ai-playtest check <config.json>`
//          `ai-playtest diff <config.json> --base <label> --head <label> [--accept <file>]`
//          `ai-playtest --help | --version`
// Exit codes: 0 ok, 1 usage, 2 config/report, 3 provider, 4 run error, 5 diff found open regressions.

import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, lintCriteria, ConfigError, VERSION } from './config.js';
import { createOpenRouterClient, OpenRouterError } from './openrouter.js';
import { createOllamaClient, OllamaError } from './ollama.js';
import { createRoutedClient, providersInUse } from './providers.js';
import { createDecisionsClient, DecisionsError } from './decisions.js';
import { rescoreRun } from './rescore.js';
import { diffRuns, parseAcceptances, openFindings, renderDiff } from './diff.js';
import { resolveProfile, composePersona, PersonaError, PROFILES } from './personas.js';
import { personaLabel, saveProfile, loadProfile, writeProfileReport } from './profile-report.js';
import { runAll, type SeatResult } from './run.js';
import { writeReport, writeAggregateReport, writeAggregateFromRuns, isAggregateDir, listRunSiblings, readRun, ReportError, criterionMetBySeats, isEmptyDegradedPanel } from './report.js';
import { summarizeRuns } from './stats.js';
import { PtyUnavailableError } from './pty-driver.js';

export function usage(): string {
  return [
    'ai-playtest -- family-diverse AI playtesting for text games',
    '',
    'Usage:',
    '  ai-playtest run <config.json> [--label <name>] [--seats <id,id>] [--turns <n>] [--runs <n>] [--serial] [--profile <name>] [--personas <id,id>]',
    '  ai-playtest report <config.json> --label <name>',
    '  ai-playtest score <config.json> --label <name>',
    '  ai-playtest check <config.json>',
    '  ai-playtest diff <config.json> --base <label> --head <label> [--accept <file>]',
    '  ai-playtest --help | --version',
    '',
    'score re-runs config.scorers over a finished run\'s saved transcripts, against the config\'s current',
    'criteria, without replaying the game; it rewrites each seat\'s scores and the report.',
    `--profile plays a persona profile (${Object.keys(PROFILES).join(', ')}, or custom from config.personas): control plus each`,
    'play style as its own label <label>--<persona>, then PERSONAS.md says which styles actually played differently.',
    '--personas narrows the profile to those ids; control always runs. report --label <label> rebuilds PERSONAS.md.',
    'diff compares two finished runs of the config and lists what got worse: a criterion the jury stopped',
    'passing, the world no longer alive, a new soft-lock lead, more ignored input, more seats ending in error.',
    'Each finding has an id and the transcript turns that show it. It writes DIFF-<base>.md and .json in the',
    'head run and exits 5 while any finding is open. --accept names a JSON file of {"accepted":[{"id","note"}]}',
    'entries; an accepted finding is still reported but no longer fails.',
    '--seats lists config seat ids (not model families). Example: --seats mistral-small,llama',
    '--help / -h prints this text from any position. --version prints the package version.',
    'check validates the JSON (no OPENROUTER_API_KEY required) and exits 2 on ConfigError.',
    'Env: OPENROUTER_API_KEY for openrouter seats (the default provider); OLLAMA_HOST for "provider": "ollama" seats',
    '(default http://127.0.0.1:11434, local tags only). The game\'s own env comes from config.game.env.',
    'Runs land under <config.runsDir>/<label>/<seat>/ with transcript.txt, critique.json, meta.json; REPORT.md and REPORT.json at the label root.',
    '',
    'Exit codes: 0 ok, 1 usage, 2 config/report, 3 provider, 4 run error, 5 diff found open regressions.',
  ].join('\n');
}

function fail(code: number, message: string, hint?: string): never {
  process.stderr.write(`error: ${message}\n${hint ? `hint: ${hint}\n` : ''}`);
  process.exit(code);
}

function hinted(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'hint' in err && typeof (err as { hint: unknown }).hint === 'string') {
    const h = (err as { hint: string }).hint;
    return h.length > 0 ? h : undefined;
  }
  return undefined;
}

/** Map coded errors to their exit codes and keep `.hint`. Unexpected throws get a debug: stack. */
function failFrom(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const hint = hinted(err);
  if (err instanceof OpenRouterError || err instanceof OllamaError || err instanceof DecisionsError) fail(3, message, hint);
  if (err instanceof ConfigError || err instanceof ReportError || err instanceof PtyUnavailableError || err instanceof PersonaError) {
    fail(2, message, hint);
  }
  const stack = err instanceof Error ? err.stack : undefined;
  const debug = Boolean(process.env.DEBUG || process.env.AI_PLAYTEST_DEBUG);
  if (stack && (!hint || debug)) process.stderr.write(`debug: ${stack}\n`);
  fail(4, message, hint);
}

const FLAGS_WITH_VALUE = new Set(['--label', '--seats', '--turns', '--runs', '--base', '--head', '--accept', '--profile', '--personas']);
const KNOWN_FLAGS = new Set(['--label', '--seats', '--turns', '--runs', '--serial', '--base', '--head', '--accept', '--profile', '--personas', '--help', '-h', '--version']);
const KNOWN_VERBS = new Set(['run', 'report', 'check', 'score', 'diff']);

function rejectUnknownFlags(args: string[]): void {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (a === '-h' || !a.startsWith('-')) {
      if (FLAGS_WITH_VALUE.has(a) && args[i + 1] !== undefined) i++;
      continue;
    }
    if (!a.startsWith('--') || !KNOWN_FLAGS.has(a)) {
      fail(1, `unknown flag ${a}`, usage());
    }
    if (FLAGS_WITH_VALUE.has(a) && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
  }
}

function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      out.push(...args.slice(i + 1));
      break;
    }
    if (a === '-h' || a.startsWith('--')) {
      if (FLAGS_WITH_VALUE.has(a) && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * Read `--name value`. Returns undefined when the flag is absent; throws when it
 * is present but its value is missing or is itself another flag — `--turns
 * --serial` used to silently read "--serial" as the turn count.
 */
export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    if (name === '--turns' || name === '--runs') {
      fail(2, `${name} must be a positive whole number, got "${value ?? ''}"`, `e.g. ${name} 3`);
    }
    fail(1, `${name} needs a value`, `you wrote "${name}${value ? ` ${value}` : ''}"`);
  }
  return value;
}

/** A turn budget has to be a positive whole number; Number("abc") is NaN. */
export function parseTurns(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    fail(2, `--turns must be a positive whole number, got "${raw}"`, 'e.g. --turns 40');
  }
  return n;
}

export function parseRuns(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    fail(2, `--runs must be a positive whole number, got "${raw}"`, 'e.g. --runs 3');
  }
  return n;
}

function hasVerdict(r: { panel?: unknown; critique?: unknown }): boolean {
  // An empty degraded panel is not a verdict: alive:false there is a hole,
  // not a fail-closed dead seat. Exit 4 (no-verdict andon) must still fire.
  if (r.panel != null && !isEmptyDegradedPanel(r.panel)) return true;
  return r.critique != null;
}

function notePlayFailures(results: Array<{ endedBy: string }>): void {
  const n = results.filter((r) => r.endedBy === 'error').length;
  // Mixed play-failure must still surface in CI logs even when the process
  // stays 0 because some other seat produced a verdict.
  if (n > 0 && n < results.length) {
    process.stderr.write(`${n}/${results.length} seats ended by error\n`);
  }
}

function resolveSeatIds(known: string[], raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const requested = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) {
    fail(1, '--seats matched no seat ids', `known seat ids: ${known.join(', ')} (seat id, not family)`);
  }
  const unknown = requested.filter((id) => !known.includes(id));
  if (unknown.length > 0) {
    fail(
      2,
      `unknown seat id${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
      `known seat ids: ${known.join(', ')} (seat id, not family)`,
    );
  }
  return requested;
}

function formatSeatDone(r: SeatResult): string {
  const head = `  [${r.seat.id}] done: ${r.turnsPlayed} turns, ended by ${r.endedBy}${r.error ? ` (${r.error})` : ''}`;
  if (r.panel && !isEmptyDegradedPanel(r.panel)) {
    const asked = r.panel.jurors.length;
    const answered = (r.panel.critiques ?? []).filter((c) => c.critique).length;
    const jury = `jury ${r.panel.alive ? 'ALIVE' : 'not alive'}`;
    const count = (r.panel.critiques ?? []).length > 0 && answered !== asked
      ? `${answered}/${asked} jurors answered`
      : `${asked} juror${asked === 1 ? '' : 's'}`;
    return `${head}, ${jury} (${count})\n`;
  }
  if (r.critique) {
    const degraded = isEmptyDegradedPanel(r.panel) && r.panel?.degraded ? `; ${r.panel.degraded}` : '';
    return `${head}, critique ${r.critique.alive ? 'ALIVE' : 'not alive'} (testimony${degraded})\n`;
  }
  if (isEmptyDegradedPanel(r.panel) && r.panel?.degraded) {
    return `${head}, no jury verdict (${r.panel.degraded})\n`;
  }
  return `${head}, failed (${r.critiqueError})\n`;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.some((a) => a === '--help' || a === '-h')) {
    process.stdout.write(usage() + '\n');
    process.exit(0);
  }
  if (argv.some((a) => a === '--version')) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  rejectUnknownFlags(argv);
  const pos = positionals(argv);
  const verb = pos[0];
  if (!verb) { process.stdout.write(usage() + '\n'); process.exit(1); }
  if (!KNOWN_VERBS.has(verb)) fail(1, `unknown verb ${verb}`, usage());
  const configPath = pos[1];
  if (!configPath) fail(1, `${verb} needs a config path`, usage());

  let cfg;
  try {
    cfg = await loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) fail(2, err.message, err.hint);
    throw err;
  }

  const lint = lintCriteria(cfg.criteria);
  const writeLint = () => {
    for (const l of lint) {
      process.stdout.write(`warn: criterion ${l.id} ${l.why}; it may bundle two claims, and judges answer the easier one. Split it into one observable claim per criterion.\n`);
    }
  };

  if (verb === 'check') {
    process.stdout.write(`ok: ${cfg.name} (schemaVersion ${cfg.schemaVersion}, ${cfg.seats.length} seat${cfg.seats.length === 1 ? '' : 's'})\n`);
    writeLint();
    return;
  }
  if (verb === 'run' || verb === 'score') writeLint();

  if (verb === 'diff') {
    const baseLabel = flag(argv, '--base');
    const headLabel = flag(argv, '--head');
    if (!baseLabel || !headLabel) fail(1, 'diff needs --base and --head', 'name two finished runs, e.g. --base v1 --head v2');
    const baseDir = join(cfg.runsDir, baseLabel!);
    const headDir = join(cfg.runsDir, headLabel!);
    for (const d of [baseDir, headDir]) if (!existsSync(d)) fail(2, `no run at ${d}`, 'check --base and --head against runs under runsDir');
    try {
      const acceptPath = flag(argv, '--accept');
      let accepted: ReturnType<typeof parseAcceptances> = [];
      if (acceptPath) {
        if (!existsSync(acceptPath)) fail(2, `no acceptance file at ${acceptPath}`, 'create it, or drop --accept');
        accepted = parseAcceptances(await readFile(acceptPath, 'utf8'), acceptPath);
      }
      const result = await diffRuns(baseDir, headDir, { base: baseLabel!, head: headLabel! }, cfg.criteria.map((c) => c.id), accepted);
      const md = renderDiff(cfg.name, result);
      const stem = join(headDir, `DIFF-${baseLabel}`);
      await writeFile(`${stem}.md`, md + '\n', 'utf8');
      await writeFile(`${stem}.json`, JSON.stringify({ kind: 'diff', name: cfg.name, ...result }, null, 2) + '\n', 'utf8');
      for (const f of result.findings) {
        process.stdout.write(`  ${f.accepted ? 'accepted' : 'OPEN    '} ${f.id}: ${f.base} -> ${f.head}${f.scorerNote ? ` (${f.scorerNote})` : ''}\n`);
      }
      for (const i of result.improvements) process.stdout.write(`  better   ${i.id}: ${i.base} -> ${i.head}\n`);
      for (const a of result.unusedAcceptances) process.stdout.write(`warn: acceptance ${a.id} matched nothing in this diff\n`);
      process.stdout.write(`wrote ${stem}.md\n`);
      const open = openFindings(result);
      if (open.length > 0) fail(5, `${open.length} open finding${open.length === 1 ? '' : 's'} between ${baseLabel} and ${headLabel}`, `read ${stem}.md; fix the build, or accept each id with a note in an --accept file`);
    } catch (err) {
      failFrom(err);
    }
    return;
  }

  const label = flag(argv, '--label') ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (verb === 'score') {
    if (!flag(argv, '--label')) fail(1, 'score needs --label', 'name the finished run to score, e.g. --label phase9');
    if (cfg.scorers.length === 0) fail(2, 'config has no scorers', 'add "scorers": [{ "kind": "jev" }] to the config');
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) fail(3, 'OPENROUTER_API_KEY is not set', 'scorers run on OpenRouter\'s Decisions API');
    const runDir = join(cfg.runsDir, label);
    if (!existsSync(runDir)) fail(2, `no run at ${runDir}`, 'check --label');
    try {
      const seats = await rescoreRun(cfg, runDir, createDecisionsClient({ apiKey: key! }));
      if (seats.length === 0) fail(2, `no seat transcripts under ${runDir}`, 'score reads <seat>/transcript.txt and meta.json from a finished run');
      for (const s of seats) {
        for (const r of s.results) {
          const cells = r.scores.map((x) => `${x.id} ${x.p === null ? '—' : x.p.toFixed(2)}`).join(', ');
          process.stdout.write(`  [${s.seat}] ${r.scorer}: ${r.error ? `unscored (${r.error})` : cells}${r.clipped ? ' (transcript trimmed)' : ''}\n`);
        }
      }
      const path = await writeReport(cfg.name, runDir, label, cfg.criteria.map((c) => c.id));
      process.stdout.write(`scored against the config's current criteria; wrote ${path}\n`);
    } catch (err) {
      failFrom(err);
    }
    return;
  }

  if (verb === 'report') {
    // Without this the label defaulted to "now", and rebuilding a report read a
    // directory that cannot exist, surfacing as a raw ENOENT rather than a
    // coded error naming the real problem.
    if (!flag(argv, '--label')) fail(1, 'report needs --label', 'name the run to rebuild, e.g. --label phase9');
    const runDir = join(cfg.runsDir, label);
    if (!existsSync(runDir)) fail(2, `no run at ${runDir}`, 'check --label, or run the playtest first');
    try {
      const saved = await loadProfile(cfg.runsDir, label);
      if (saved) {
        const { path } = await writeProfileReport(cfg.name, cfg.runsDir, label, saved);
        process.stdout.write(`wrote ${path}
`);
        return;
      }
      const siblings = await listRunSiblings(cfg.runsDir, label);
      const aggregate = await isAggregateDir(runDir);
      if (aggregate && siblings.length === 0) {
        fail(2, `${runDir} is a multi-run aggregate`, `rebuild a single run with --label ${label}-r01`);
      }
      let rebuildFromSiblings = aggregate && siblings.length > 0;
      if (!rebuildFromSiblings && siblings.length > 0) {
        const existing = await readRun(runDir);
        rebuildFromSiblings = existing.length === 0 && existing.skipped.length === 0;
      }
      if (rebuildFromSiblings) {
        const path = await writeAggregateFromRuns(
          cfg.name, runDir, label, cfg.criteria.map((c) => c.id), siblings, cfg.runsDir,
        );
        process.stdout.write(`wrote ${path}\n`);
        return;
      }
      const path = await writeReport(cfg.name, runDir, label, cfg.criteria.map((c) => c.id));
      process.stdout.write(`wrote ${path}\n`);
    } catch (err) {
      failFrom(err);
    }
    return;
  }

  const turns = flag(argv, '--turns');
  if (turns) cfg.turns = parseTurns(turns);
  const runsFlag = flag(argv, '--runs');
  const runCount = runsFlag ? parseRuns(runsFlag) : 1;
  const profileFlag = flag(argv, '--profile');
  const personasFlag = flag(argv, '--personas');
  let profile: ReturnType<typeof resolveProfile> | undefined;
  if (profileFlag || personasFlag || cfg.personas) {
    if (runCount !== 1) fail(1, '--runs and a persona profile cannot be combined yet', 'run the profile once per label, or drop --runs');
    const name = profileFlag ?? cfg.personas?.profile;
    if (!name) fail(1, '--personas needs a profile', 'add --profile <name> or config.personas.profile');
    try {
      profile = resolveProfile({
        ...(cfg.personas ?? {}),
        profile: name!,
        ...(personasFlag ? { only: personasFlag.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
      });
    } catch (err) {
      failFrom(err);
    }
  }
  const seats = resolveSeatIds(cfg.seats.map((s) => s.id), flag(argv, '--seats'));
  const used = providersInUse(cfg.seats, seats, cfg.panelSize);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (used.has('openrouter') && !apiKey) {
    fail(3, 'OPENROUTER_API_KEY is not set', 'export it, or seat local models with "provider": "ollama"');
  }
  if (cfg.scorers.length > 0 && !apiKey) {
    fail(3, 'OPENROUTER_API_KEY is not set, and config.scorers needs it', `the ${cfg.scorers.map((s) => s.kind).join(', ')} scorer runs on OpenRouter's Decisions API; set the key or remove "scorers"`);
  }
  const client = createRoutedClient(cfg.seats, {
    ...(used.has('openrouter') && apiKey ? { openrouter: createOpenRouterClient({ apiKey }) } : {}),
    ...(used.has('ollama') ? { ollama: createOllamaClient() } : {}),
  });
  const decisions = cfg.scorers.length > 0 && apiKey ? createDecisionsClient({ apiKey }) : undefined;
  if (used.has('ollama') && !argv.includes('--serial')) {
    process.stdout.write('note: local seats share one GPU; --serial keeps the daemon from swapping models between seats every turn\n');
  }

  process.stdout.write(`${cfg.name}: ${(seats ?? cfg.seats.map((s) => s.id)).join(', ')} × ${cfg.turns} turns × ${runCount} run${runCount === 1 ? '' : 's'} → ${join(cfg.runsDir, label)}\n`);
  if (runCount !== 1) process.stdout.write(`${summarizeRuns([], runCount).warning}\n`);
  const onTurn = (seat: { id: string }, t: { turn: number; reason: string; ms: number; input: string }) =>
    process.stdout.write(`  [${seat.id}] t${t.turn} (${t.reason}, ${t.ms}ms) > ${t.input}\n`);
  const onSeatDone = (r: SeatResult) => process.stdout.write(formatSeatDone(r));
  try {
    const criterionIds = cfg.criteria.map((c) => c.id);
    if (profile) {
      for (const n of profile.notes) process.stdout.write(`note: ${n}
`);
      await saveProfile(cfg.runsDir, label, profile);
      let anyVerdict = false;
      let anyPlayOk = false;
      for (const p of profile.personas) {
        const runLabel = personaLabel(label, p.id);
        process.stdout.write(`-- persona ${p.id} (${runLabel})
`);
        const results = await runAll({ ...cfg, persona: composePersona(cfg.persona, p, profile.briefing) }, {
          label: runLabel, client, decisions, seats, parallel: !argv.includes('--serial'), onTurn, onSeatDone,
        });
        await writeReport(`${cfg.name} (${p.id})`, join(cfg.runsDir, runLabel), runLabel, criterionIds);
        notePlayFailures(results);
        if (results.some((r) => hasVerdict(r))) anyVerdict = true;
        if (results.some((r) => r.endedBy !== 'error')) anyPlayOk = true;
      }
      const { path, result } = await writeProfileReport(cfg.name, cfg.runsDir, label, profile);
      const judged = result.personas.filter((x) => x.target);
      process.stdout.write(`personas: ${judged.filter((x) => x.verdict === 'distinct').length}/${judged.length} played distinctly; ${path}
`);
      if (!anyVerdict) fail(4, 'no seat produced a verdict for any persona');
      if (!anyPlayOk) fail(4, 'every seat failed for every persona');
    } else if (runCount === 1) {
      const results = await runAll(cfg, {
        label, client, decisions, seats, parallel: !argv.includes('--serial'), onTurn, onSeatDone,
      });
      if (results.length === 0) fail(4, 'no seats ran', 'check --seats against the config seat ids, not families');
      const path = await writeReport(cfg.name, join(cfg.runsDir, label), label, criterionIds);
      process.stdout.write(`report: ${path}\n`);
      notePlayFailures(results);
      if (results.every((r) => !hasVerdict(r))) fail(4, 'no seat produced a verdict', results[0]?.critiqueError ?? results[0]?.error);
      const failed = results.filter((r) => r.endedBy === 'error');
      if (failed.length === results.length) fail(4, 'every seat failed', failed[0]?.error);
    } else {
      const successes = Object.fromEntries(criterionIds.map((id) => [id, 0]));
      const worstOfN: Array<{ run: string; alive: number; of: number }> = [];
      let anyVerdict = false;
      let anyPlayOk = false;
      for (let i = 1; i <= runCount; i++) {
        const runLabel = `${label}-r${String(i).padStart(2, '0')}`;
        process.stdout.write(`-- run ${i}/${runCount} (${runLabel})\n`);
        const results = await runAll(cfg, {
          label: runLabel, client, decisions, seats, parallel: !argv.includes('--serial'), onTurn, onSeatDone,
        });
        await writeReport(cfg.name, join(cfg.runsDir, runLabel), runLabel, criterionIds);
        if (results.length === 0) continue;
        notePlayFailures(results);
        if (results.some((r) => hasVerdict(r))) anyVerdict = true;
        if (results.some((r) => r.endedBy !== 'error')) anyPlayOk = true;
        for (const id of criterionIds) if (criterionMetBySeats(results, id)) successes[id]++;
        const alive = results.filter((r) => (
          r.panel && !isEmptyDegradedPanel(r.panel) ? r.panel.alive : r.critique?.alive
        ) === true).length;
        worstOfN.push({ run: runLabel, alive, of: results.length });
      }
      await mkdir(join(cfg.runsDir, label), { recursive: true });
      const path = await writeAggregateReport(
        cfg.name, join(cfg.runsDir, label), label, runCount,
        criterionIds.map((id) => ({ id, successes: successes[id] })),
        worstOfN,
      );
      process.stdout.write(`aggregate: ${path}\n`);
      if (!anyVerdict) fail(4, 'no seat produced a verdict in any run');
      if (!anyPlayOk) fail(4, 'every seat failed in every run');
    }
  } catch (err) {
    failFrom(err);
  }
}

function runningAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url).toLowerCase() === resolve(entry).toLowerCase();
  } catch {
    return false;
  }
}

if (runningAsCli()) {
  main().catch((err) => failFrom(err));
}
