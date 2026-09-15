// A full-screen TUI for tests: enters the alternate screen buffer and redraws
// with cursor addressing on every input, the way a ratatui/ncurses game does.
// A line-append reader sees three stacked copies of this screen; a terminal
// grid sees one current screen.
import { createInterface } from 'node:readline';

const ESC = '';
const mode = process.argv[2];

// Modes that pin waitForTurn's non-prompt exits. Each keeps the event loop
// alive without matching "What do you do?" so the named ReadyReason is unique.
if (mode === 'timeout') {
  setInterval(() => {}, 1e9);
} else if (mode === 'idle') {
  process.stdout.write('You stand in a ruined chapel. Exits: nave.\n');
  setInterval(() => {}, 1e9);
} else if (mode === 'sentinel') {
  process.stdout.write('READY_SENTINEL_9f3e\nChapel Nave\n');
  setInterval(() => {}, 1e9);
} else if (mode === 'ready-signal') {
  process.stdout.write(`${ESC}[?2004h`);
  process.stdout.write('Chapel Nave (no prompt)\n');
  setInterval(() => {}, 1e9);
} else {

let hp = 40;
let turn = 0;
let last = '-';

function draw() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  process.stdout.write(`${ESC}[1;1H${ESC}[1m== CHAPEL NAVE ==${ESC}[0m`);
  const filled = Math.max(0, Math.round(hp / 10));
  process.stdout.write(`${ESC}[2;1HHP [${'#'.repeat(filled)}${'-'.repeat(10 - filled)}] ${hp}/100`);
  process.stdout.write(`${ESC}[3;1HTurn ${turn}   Last: ${last}`);
  process.stdout.write(`${ESC}[5;1H[1] Attack   [2] Flee   [3] Look`);
  process.stdout.write(`${ESC}[7;1HWhat do you do? `);
}

process.stdout.write(`${ESC}[?1049h`); // alternate screen buffer
draw();

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const s = line.trim();
  if (s === 'quit') {
    process.stdout.write(`${ESC}[?1049l`);
    process.stdout.write('Saved. Goodbye.\n');
    process.exit(0);
  }
  turn++;
  if (s === '1') { hp -= 10; last = 'attacked'; }
  else if (s === '2') { last = 'fled'; }
  else { last = `looked (${s})`; }
  draw();
});

}
