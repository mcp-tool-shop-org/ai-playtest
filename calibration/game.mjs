#!/usr/bin/env node
// game.mjs -- Harrow Gate, the calibration game.
//
// A small text adventure whose every playtest variable is a switch, so the
// playtester can be scored against games where the right answer is known.
// Research found no existing test bed that lets these be set on purpose
// (docs/research-4.md); this is the one we made.
//
//   node calibration/game.mjs --variant baseline
//   node calibration/game.mjs --knobs '{"worldMoves":false}'
//
// Each turn the game writes one JSON line to STDERR recording where the player is
// and what happened. The stdio driver keeps stderr out of every model's sight and
// saves it as stderr.txt, so the answer key comes from the game itself, per
// transcript: "the world moved" is true only if a bell actually tolled while this
// player was playing. calibrate.mjs grades judges against it.
//
// Deterministic: no randomness, no clock. The same inputs give the same game.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Every switch, at its "a healthy game" setting. */
export const DEFAULT_KNOBS = Object.freeze({
  worldMoves: true,        // a bell tolls on its own and the market changes with the hour
  refusal: 'character',    // who refuses at the gate: 'character' | 'system' | 'none' (the gate is open)
  prompt: 'clear',         // 'clear' lists exits and commands; 'bare' is a lone '>'
  reacts: true,            // false: every input gets the same answer (ignored input)
  choiceCost: true,        // the archive is dark; lighting the lamp spends visible oil
  goal: 'stated',          // 'stated' | 'none'
  descriptions: 'varied',  // 'varied' changes a place on a return visit; 'repeats' never does
  deadEnd: false,          // true: the cellar trapdoor shuts behind you, no way out
});

function parseArgs(argv) {
  const at = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const variant = at('variant') ?? 'baseline';
  const variants = JSON.parse(readFileSync(path.join(HERE, 'variants.json'), 'utf8')).variants;
  const preset = variants.find((v) => v.name === variant);
  if (!preset && !at('knobs')) {
    process.stderr.write(`unknown variant ${variant}; known: ${variants.map((v) => v.name).join(', ')}\n`);
    process.exit(2);
  }
  const knobs = { ...DEFAULT_KNOBS, ...(preset?.knobs ?? {}), ...(at('knobs') ? JSON.parse(at('knobs')) : {}) };
  return { variant: preset ? variant : 'custom', knobs };
}

const ROOMS = {
  square: {
    name: 'the square',
    exits: { north: 'market', east: 'chapel', west: 'gatehouse' },
    text: [
      'Harrow Gate\'s square. A dry fountain, a notice board, cobbles worn smooth by carts.',
      'The square again. Someone has chalked a crooked arrow on the fountain, pointing west.',
    ],
  },
  market: {
    name: 'the market',
    exits: { south: 'square', east: 'archive' },
    text: [
      'The market. Awnings sag over trestles of salt fish and rope.',
      'The market again. The rope seller has moved his stall nearer the archive door.',
    ],
  },
  archive: {
    name: 'the archive',
    exits: { west: 'market' },
    text: [
      'The town archive. Shelves of ledgers lean in toward a reading desk.',
      'The archive again. Dust you disturbed earlier still hangs in the air.',
    ],
  },
  chapel: {
    name: 'the chapel',
    exits: { west: 'square', down: 'cellar' },
    text: [
      'A small chapel. Candles gutter by a trapdoor in the floor.',
      'The chapel again. One of the candles has burned out since you were here.',
    ],
  },
  cellar: {
    name: 'the cellar',
    exits: { up: 'chapel' },
    text: [
      'A low cellar of barrels and old nets.',
      'The cellar again. Water drips somewhere behind the barrels.',
    ],
  },
  gatehouse: {
    name: 'the gatehouse',
    exits: { east: 'square', west: 'road' },
    text: [
      'The gatehouse. A heavy arch opens on the west road.',
      'The gatehouse again. The arch looks narrower than you remembered.',
    ],
  },
};

const HOUR_NAMES = ['', '', '', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TURNS_PER_HOUR = 4;
const CLOSING_HOUR = 9;

export function createGame(knobs, log) {
  const st = { room: 'square', turn: 0, hour: 3, oil: 3, lit: false, seal: false, visits: { square: 1 }, lastText: {}, over: false, stuck: false };

  const marketLine = () => {
    if (!knobs.worldMoves) return '';
    if (st.hour < 5) return ' Stallholders call out prices.';
    if (st.hour < 7) return ' Shutters are coming down along the stalls.';
    return ' The stalls are shut and the square is emptying.';
  };

  function describe() {
    const r = ROOMS[st.room];
    const seen = st.visits[st.room] ?? 1;
    let text = knobs.descriptions === 'varied' && seen > 1 ? r.text[1] : r.text[0];
    if (st.room === 'market') text += marketLine();
    if (st.room === 'archive') {
      if (knobs.choiceCost && !st.lit) text += ' It is too dark to read the spines.';
      else if (!st.seal) text += ' On the desk, under a ledger, lies the warden\'s brass seal.';
    }
    if (st.room === 'cellar' && st.stuck) text = 'The cellar. The trapdoor overhead will not budge. There is no other way out.';
    return text;
  }

  function promptBlock() {
    if (knobs.prompt === 'bare') return '\n> ';
    const exits = st.stuck ? 'none' : Object.entries(ROOMS[st.room].exits).map(([d, to]) => `${d} (${to === 'road' ? 'the west road' : ROOMS[to].name})`).join(', ');
    const lamp = knobs.choiceCost ? `light lamp (oil left: ${st.oil}), ` : '';
    return `\nExits: ${exits}.\nYou can type: look, go <direction>, take <thing>, ${lamp}wait, inventory, quit.\nWhat do you do? `;
  }

  function intro() {
    const goal = knobs.goal === 'stated'
      ? 'The gate closes at dusk. Find the warden\'s seal in the archive and get out through the gatehouse before then.\n\n'
      : '';
    const first = describe();
    st.lastText[st.room] = first;
    return `HARROW GATE\n\n${goal}${first}${promptBlock()}`;
  }

  /** Advance the town's clock. Returns a line for the player, or ''. */
  function tick(events) {
    if (!knobs.worldMoves || st.over) return '';
    if (st.turn % TURNS_PER_HOUR !== 0) return '';
    st.hour += 1;
    events.push('tick');
    if (st.hour >= CLOSING_HOUR) {
      st.over = true;
      events.push('lose');
      return `\nThe bell tolls ${HOUR_NAMES[CLOSING_HOUR]}. Somewhere west, the gate is barred for the night. You are still inside the walls.`;
    }
    return `\nThe bell in the chapel tower tolls ${HOUR_NAMES[st.hour]}.`;
  }

  function move(dir, events) {
    if (st.stuck) return 'The trapdoor overhead will not budge. There is no way out.';
    const to = ROOMS[st.room].exits[dir];
    if (!to) return 'You cannot go that way.';
    if (to === 'road') {
      if (knobs.refusal !== 'none' && !st.seal) {
        events.push(`refusal:${knobs.refusal}`);
        return knobs.refusal === 'character'
          ? 'Warden Sela steps into the arch. "Not without the seal, friend. Orders are orders."'
          : '[ACCESS DENIED] gate.west requires item:seal';
      }
      st.over = true;
      events.push('win');
      return st.seal
        ? 'You show the seal. The warden waves you through, and the west road opens ahead of you.'
        : 'Nobody stops you. You walk through the arch and out onto the west road.';
    }
    st.room = to;
    st.lit = false;
    st.visits[to] = (st.visits[to] ?? 0) + 1;
    if (st.visits[to] > 1) events.push('revisit');
    if (to === 'cellar' && knobs.deadEnd) {
      st.stuck = true;
      events.push('dead-end');
      return `${shown(events)}\nThe trapdoor slams shut above you. You push at it; it will not move.`;
    }
    return shown(events);
  }

  /**
   * Describe the room on arrival and record whether it reads differently from the
   * last time this room was shown. Measured from the text itself, because a place
   * can change two ways: a varied description on a return visit, or the hour
   * changing the market while descriptions repeat.
   */
  function shown(events) {
    const text = describe();
    const before = st.lastText[st.room];
    if (before !== undefined && before !== text) events.push('changed-on-return');
    st.lastText[st.room] = text;
    return text;
  }

  function act(raw) {
    const events = [];
    const input = String(raw).trim().toLowerCase();
    st.turn += 1;
    let out;
    if (input === 'quit') {
      st.over = true;
      events.push('quit');
      out = 'You stop here.';
    } else if (!knobs.reacts) {
      events.push('ignored');
      out = ROOMS.square.text[0];
    } else {
      const words = input.replace(/^go\s+/, '').split(/\s+/);
      const dirs = { n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down' };
      const dir = dirs[words[0]] ?? words[0];
      if (['north', 'south', 'east', 'west', 'up', 'down'].includes(dir)) out = move(dir, events);
      else if (input === 'look' || input === 'l') out = describe();
      else if (input === 'wait' || input === 'z') out = 'You wait.';
      else if (input === 'inventory' || input === 'i') {
        out = `You carry ${[knobs.choiceCost ? `a lamp (oil: ${st.oil})` : 'nothing much', st.seal ? 'the warden\'s seal' : ''].filter(Boolean).join(' and ')}.`;
      } else if (/^light( the)? lamp$|^light$/.test(input)) {
        if (!knobs.choiceCost) out = 'You have no lamp to light.';
        else if (st.oil <= 0) out = 'The lamp is dry. There is no oil left.';
        else {
          st.oil -= 1;
          st.lit = true;
          events.push('cost');
          out = `You light the lamp. Oil left: ${st.oil}.${st.room === 'archive' ? ' The shelves come out of the dark.' : ''}`;
        }
      } else if (/^take( the)? seal$|^get( the)? seal$/.test(input)) {
        if (st.room !== 'archive') out = 'There is no seal here.';
        else if (knobs.choiceCost && !st.lit) out = 'It is too dark to find anything. You could light your lamp.';
        else if (st.seal) out = 'You already have it.';
        else { st.seal = true; events.push('took-seal'); out = 'You take the warden\'s brass seal.'; }
      } else {
        events.push('unknown-command');
        out = 'You cannot do that here.';
      }
    }
    if (st.stuck) events.push('stuck');
    out += tick(events);
    log({ t: st.turn, in: input, room: st.room, ev: events, hour: st.hour, oil: st.oil });
    return { text: st.over ? out : `${out}${promptBlock()}`, over: st.over };
  }

  return { intro, act, state: st };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { variant, knobs } = parseArgs(process.argv.slice(2));
  const log = (o) => process.stderr.write(`${JSON.stringify({ cal: 1, ...o })}\n`);
  log({ variant, knobs });
  const game = createGame(knobs, log);
  process.stdout.write(game.intro());
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const r = game.act(line);
    process.stdout.write(`\n${r.text}`);
    if (r.over) { process.stdout.write('\n'); rl.close(); process.exit(0); }
  });
}
