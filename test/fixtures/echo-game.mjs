// A tiny stdio game for tests: prints a screen, waits at "What do you do?",
// reacts to a few inputs, exits on "quit". Deterministic; no dependencies.
import { createInterface } from 'node:readline';

const mode = process.argv[2];
if (mode === 'timeout') {
  process.stdout.write('one line then silence\n');
  setInterval(() => {}, 1e9);
} else if (mode === 'idle') {
  process.stdout.write('You stand in a ruined chapel. Exits: nave, alcove.\nHeat 0\n');
  setInterval(() => {}, 1e9);
} else {

const rl = createInterface({ input: process.stdin, terminal: false });
let turn = 0;
let heat = 0;
const screen = (extra = '') => {
  process.stdout.write(`\n\x1b[1m== Turn ${turn} ==\x1b[0m\n${extra}You stand in a ruined chapel. Exits: nave, alcove.\nHeat ${heat}\n  What do you do?\n`);
};
process.stdout.write('Character name: ');
let named = false;
rl.on('line', (line) => {
  const input = line.trim();
  if (!named) { named = true; screen(`Welcome, ${input}.\n`); return; }
  if (input === 'quit') { process.stdout.write('Saved. Goodbye.\n'); rl.close(); process.exit(0); }
  turn++;
  if (/^attack/.test(input)) { heat += 5; screen(`You strike. The street notices (heat ${heat}).\n`); return; }
  if (/^ambush-me$/.test(input)) { screen('── Ambush: Chapel Patrol in Chapel Nave ──\n'); return; }
  screen(`You ${input}.\n`);
});

}
