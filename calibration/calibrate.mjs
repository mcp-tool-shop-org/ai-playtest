#!/usr/bin/env node
// calibrate.mjs -- run the playtester over every Harrow Gate build and grade it.
//
//   node calibration/calibrate.mjs make  --seats calibration/seats.example.json [--turns 25] [--scorers jev]
//   node calibration/calibrate.mjs run   --label cal-01 [--variants baseline,deaf]
//   node calibration/calibrate.mjs grade --label cal-01 [--band 0.35,0.65]
//
// make writes one playtest config per build into calibration/configs/, each with
// the shared criteria and its own runsDir under calibration/runs/<build>/. run plays
// them in turn (serially, one build at a time). grade reads every seat's meta.json
// and the game's truth log (stderr.txt) and writes CALIBRATION-<label>.md and .json
// next to the runs. Needs `npm run build` first; it imports the built library.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONFIGS = path.join(HERE, 'configs');
const RUNS = path.join(HERE, 'runs');

const argv = process.argv.slice(2);
const verb = argv[0];
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const die = (msg, hint) => { process.stderr.write(`error: ${msg}\n${hint ? `hint: ${hint}\n` : ''}`); process.exit(1); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const variants = readJson(path.join(HERE, 'variants.json')).variants;
const criteria = readJson(path.join(HERE, 'criteria.json')).criteria;

if (verb === 'make') {
  const seatsPath = flag('seats');
  if (!seatsPath) die('make needs --seats <file.json>', 'a JSON array of seats, e.g. calibration/seats.example.json');
  const seats = readJson(seatsPath);
  const turns = Number(flag('turns') ?? 25);
  const scorers = flag('scorers') ? flag('scorers').split(',').map((kind) => ({ kind })) : [];
  mkdirSync(CONFIGS, { recursive: true });
  for (const v of variants) {
    const cfg = {
      name: `Harrow Gate calibration: ${v.name}`,
      game: {
        command: process.execPath,
        args: [path.join(HERE, 'game.mjs'), '--variant', v.name],
        promptPatterns: ['What do you do\\?\\s*$', '^>\\s*$'],
        promptQuietMs: 300,
        idleQuietMs: 3000,
        screenTimeoutMs: 30000,
        quitInputs: ['quit'],
      },
      seats,
      turns,
      persona: 'You are playing a short text adventure set in a walled town. Nobody has explained it to you. Read what the game shows you and play the way you would at home.',
      criteria,
      verifiers: { absorbingMinTurns: 4 },
      ...(scorers.length ? { scorers } : {}),
      runsDir: path.join(RUNS, v.name),
    };
    writeFileSync(path.join(CONFIGS, `${v.name}.playtest.json`), JSON.stringify(cfg, null, 2) + '\n');
  }
  process.stdout.write(`wrote ${variants.length} configs to ${CONFIGS}\n`);
} else if (verb === 'run') {
  const label = flag('label') ?? die('run needs --label');
  if (!existsSync(CONFIGS)) die('no configs yet', 'run `calibrate.mjs make --seats ...` first');
  const only = flag('variants')?.split(',');
  for (const file of readdirSync(CONFIGS).filter((f) => f.endsWith('.playtest.json')).sort()) {
    const name = file.replace('.playtest.json', '');
    if (only && !only.includes(name)) continue;
    process.stdout.write(`\n== ${name}\n`);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'cli.js'), 'run', path.join(CONFIGS, file), '--label', label, '--serial'], { stdio: 'inherit' });
    if (r.status !== 0) process.stdout.write(`(${name} exited ${r.status}; grading uses whatever it wrote)\n`);
  }
} else if (verb === 'grade') {
  const label = flag('label') ?? die('grade needs --label');
  const lib = await import(pathToFileURL(path.join(ROOT, 'dist', 'index.js')).href).catch(() => die('dist/ not built', 'npm run build'));
  const band = flag('band') ? flag('band').split(',').map(Number) : [0.35, 0.65];
  const key = readJson(path.join(HERE, 'answer-key.json'));
  if (!existsSync(RUNS)) die(`no runs yet under ${RUNS}`, `run \`calibrate.mjs run --label ${label}\` first`);
  const graded = await lib.gradeRuns(RUNS, label, key);
  if (graded.seats === 0) die(`nothing to grade for label ${label} under ${RUNS}`, 'run the builds first');
  const summary = lib.summarize(graded, band);
  const md = lib.renderCalibration(label, graded, summary);
  writeFileSync(path.join(RUNS, `CALIBRATION-${label}.md`), md);
  writeFileSync(path.join(RUNS, `CALIBRATION-${label}.json`), JSON.stringify({ label, band, graded, summary }, null, 2) + '\n');
  process.stdout.write(md);
} else {
  die(`unknown verb ${verb ?? '(none)'}`, 'make | run | grade');
}
