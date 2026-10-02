// personas.ts — play styles, grouped into profiles, each with a test that it worked.
//
// One persona string makes every seat the same player. A profile is a set of play
// styles chosen to answer one question about the game:
//
//   scientific  Can these readings be trusted on this game?   (controls, noise floor)
//   bughunter   What is broken?                               (inputs aimed at breakage)
//   player      Who gets what out of it?                      (why people play)
//   gaming      Does it meet the habits genre players bring?  (what people already know)
//
// Five rules hold for every profile (docs/research-5.md, Lane 5):
//   1. A brief is a play style, never the mechanics under test. It is appended to
//      the config's own `persona`, which still says who the player is in this world.
//   2. Every profile run includes `control`, the config's persona with no style
//      added, as the shared baseline.
//   3. Each persona names one target signal, computed from the turn log, and no
//      two personas in a profile share one.
//   4. A persona counts only if it separates: its target beats control by the
//      noise floor AND it ranks first in its profile on that signal. Holmgård et
//      al. 2018 evolved a Completionist that lost its own metric to another
//      persona; prompts that sound different can play the same.
//   5. A persona that does not separate is reported as playing like control.

import type { Coverage } from './coverage.js';
import { isIgnored, type VerifierReport } from './verifiers.js';

export type Direction = 'high' | 'low';

/**
 * A number computed from one seat's run:
 * - `share:<tag>[,<tag>...]`: fraction of inputs with any of those action tags
 * - `novelStates`, `distinctActions`, `repeatRate`: from the coverage block
 * - `turnsPlayed`: inputs before the run ended
 * - `turnsToFinish`: the same, except a run the player quit has none
 * - `rejectedRate`: fraction of inputs the game refused or ignored
 * - `offPath`: fraction of inputs control never used
 */
export type Signal = string;

export type Target = { signal: Signal; direction: Direction };

export type PersonaSpec = {
  id: string;
  /** The play style. Empty means the config's persona alone. */
  brief: string;
  /** Absent for `control` and `replicate`, which are baselines. */
  target?: Target;
  /** Gets the profile's `briefing` (what the player was told before starting). */
  needsBriefing?: boolean;
};

export type ProfileSpec = { id: string; question: string; personas: PersonaSpec[] };

export const CONTROL: PersonaSpec = { id: 'control', brief: '' };

export const PROFILES: Record<string, ProfileSpec> = {
  scientific: {
    id: 'scientific',
    question: 'Can these readings be trusted on this game?',
    personas: [
      // Same brief as control. Their difference is the noise floor every
      // other profile's separation test uses.
      { id: 'replicate', brief: '' },
      {
        id: 'novice',
        brief: 'You have never played anything like this. You type only commands the screen tells you about. When you are unsure, you read the screen again instead of guessing.',
        target: { signal: 'rejectedRate', direction: 'low' },
      },
      {
        id: 'briefed',
        brief: 'You know what this game wants from you and how to get there. Head for it directly and do not wander.',
        target: { signal: 'turnsToFinish', direction: 'low' },
        needsBriefing: true,
      },
      {
        id: 'systematic',
        brief: 'You treat the game as an experiment. Change one thing at a time, repeat an action to see whether the result changes, and come back to check what you learned.',
        target: { signal: 'repeatRate', direction: 'high' },
      },
    ],
  },
  bughunter: {
    id: 'bughunter',
    question: 'What is broken?',
    personas: [
      {
        id: 'cartographer',
        brief: 'You map everything. Visit every place you can reach, try every exit, and note what you have not seen yet.',
        target: { signal: 'novelStates', direction: 'high' },
      },
      {
        id: 'closer',
        brief: 'You go straight for endings: finishing, saving, quitting, losing. Find out what happens when the game stops.',
        target: { signal: 'turnsPlayed', direction: 'low' },
      },
      {
        id: 'boundary-pusher',
        brief: 'You try what the game probably did not expect: odd words, things out of order, actions in the wrong place, the same command many times.',
        target: { signal: 'rejectedRate', direction: 'high' },
      },
      {
        id: 'continuity-auditor',
        brief: 'You check that the world stays consistent. Look at things again later, ask about what you saw before, and notice anything that contradicts itself.',
        target: { signal: 'share:examine,talk', direction: 'high' },
      },
    ],
  },
  player: {
    id: 'player',
    question: 'Who gets what out of it?',
    personas: [
      {
        id: 'runner',
        brief: 'You want to see how it ends. Follow the main thread and skip anything optional.',
        target: { signal: 'turnsToFinish', direction: 'low' },
      },
      {
        id: 'reader',
        brief: 'You are here for the story and the people. Talk to everyone and read everything before you move on.',
        target: { signal: 'share:talk,examine', direction: 'high' },
      },
      {
        id: 'completionist',
        brief: 'You want to find everything. Go back for what you missed and do not leave a place until you have seen all of it.',
        target: { signal: 'novelStates', direction: 'high' },
      },
      {
        id: 'grinder',
        brief: 'You like getting stronger before you push on. Fight, rest and try again rather than move ahead weak.',
        target: { signal: 'share:fight,wait', direction: 'high' },
      },
      {
        id: 'quitter',
        brief: 'Your patience is short. If you get stuck or keep failing, you stop playing.',
        target: { signal: 'share:quit', direction: 'high' },
      },
      {
        id: 'tinkerer',
        brief: 'You poke at things to see what happens: combine items, use things in odd places, take detours just to see where they go.',
        target: { signal: 'share:use', direction: 'high' },
      },
    ],
  },
  gaming: {
    id: 'gaming',
    question: 'Does it meet the habits genre players bring?',
    personas: [
      {
        id: 'genre-veteran',
        brief: 'You have finished dozens of games like this one. You reach for what they always have: saving, status and equipment screens, a menu.',
        target: { signal: 'share:save,menu', direction: 'high' },
      },
      {
        id: 'speedrunner',
        brief: 'You play for speed. Skip everything you can, take the shortest route you can find, and try doing things out of the intended order.',
        target: { signal: 'turnsToFinish', direction: 'low' },
      },
      {
        id: 'theorycrafter',
        brief: 'You work out the numbers before you commit. Inspect items, compare options and check what everything does.',
        target: { signal: 'share:examine', direction: 'high' },
      },
      {
        id: 'returning-player',
        brief: 'You are picking this up again after months away and remember little. Ask for help, look for hints and a list of commands, and check where you are.',
        target: { signal: 'share:help', direction: 'high' },
      },
    ],
  },
};

/**
 * Action tags, matched in order against the lowercased input; the first match
 * wins, so `run away` is `flee` before `run` is `move`. A game overrides or adds
 * tags with config `personas.actionTags`. Closed-set ids such as `talk:mira` match
 * on their verb.
 */
export const DEFAULT_ACTION_TAGS: Array<[string, string]> = [
  ['quit', '^(quit|exit game|stop playing)\\b'],
  ['help', '^(help|hint|hints|commands|\\?)\\b'],
  ['save', '^(save|load|restore)\\b'],
  ['flee', '^(flee|run away|escape|retreat)\\b'],
  ['fight', '^(attack|fight|spar|hit|strike|cast|shoot|defend|block|kill)\\b'],
  ['talk', '^(talk|ask|say|tell|greet|speak|answer|reply|shout)\\b'],
  ['examine', '^(look|l|examine|x|inspect|read|search|study|check)\\b'],
  ['menu', '^(i|inv|inventory|status|stats|map|journal|quests?|party|skills|menu|equipment|score)\\b'],
  ['take', '^(take|get|grab|pick|collect|loot)\\b'],
  ['use', '^(use|light|open|close|unlock|push|pull|give|put|drop|eat|drink|wear|equip|combine)\\b'],
  ['wait', '^(wait|z|rest|sleep|sit)\\b'],
  ['move', '^(go|walk|run|head|enter|exit|leave|climb|n|s|e|w|u|d|ne|nw|se|sw|north|south|east|west|up|down)\\b'],
];

export type PersonasConfig = {
  profile: string;
  /** Run only these personas (control always runs). */
  only?: string[];
  /** Extra personas, with the same shape as the built-in ones. */
  add?: PersonaSpec[];
  /** What the `briefed` persona was told: the game's goal and controls, in the author's words. */
  briefing?: string;
  /** Extra or replacement action tags: tag name to regex. */
  actionTags?: Record<string, string>;
  /** Separation margins when the profile has no replicate: shares, and counts (relative). */
  noiseFloor?: { share: number; count: number };
};

export const NOISE_DEFAULTS = { share: 0.1, count: 0.2 };

export type ResolvedProfile = {
  id: string;
  question: string;
  /** Control first, then the profile's personas in order. */
  personas: PersonaSpec[];
  briefing?: string;
  actionTags: Array<[string, string]>;
  noiseFloor: { share: number; count: number };
  /** Personas left out, and why. */
  notes: string[];
};

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export class PersonaError extends Error {
  readonly code = 'E_PERSONA';
  constructor(message: string, readonly hint: string) {
    super(message);
  }
}

export function resolveProfile(cfg: PersonasConfig): ResolvedProfile {
  const base = PROFILES[cfg.profile];
  if (!base && cfg.profile !== 'custom') {
    throw new PersonaError(`unknown persona profile "${cfg.profile}"`, `use one of: ${[...Object.keys(PROFILES), 'custom'].join(', ')}`);
  }
  let personas = [...(base?.personas ?? []), ...(cfg.add ?? [])];
  const seen = new Set<string>(['control']);
  for (const p of personas) {
    if (!ID_RE.test(p.id)) throw new PersonaError(`persona id "${p.id}" is not usable`, 'lowercase letters, digits and dashes');
    if (seen.has(p.id)) throw new PersonaError(`persona id ${p.id} used twice`, 'give each persona its own id; control is built in');
    seen.add(p.id);
  }
  if (cfg.only) {
    const unknown = cfg.only.filter((id) => id !== 'control' && !personas.some((p) => p.id === id));
    if (unknown.length > 0) throw new PersonaError(`unknown persona${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`, `this profile has: ${personas.map((p) => p.id).join(', ')}`);
    personas = personas.filter((p) => cfg.only!.includes(p.id));
  }
  const targets = new Map<string, string>();
  for (const p of personas) {
    if (!p.target) continue;
    validateSignal(p.target.signal, p.id);
    const prior = targets.get(p.target.signal);
    if (prior) throw new PersonaError(`${p.id} and ${prior} both target ${p.target.signal}`, 'each persona in a profile needs its own target signal, or the separation test cannot tell them apart');
    targets.set(p.target.signal, p.id);
  }
  const notes: string[] = [];
  if (!cfg.briefing) {
    const dropped = personas.filter((p) => p.needsBriefing);
    for (const p of dropped) notes.push(`${p.id} left out: it needs personas.briefing, the goal and controls in the author's words`);
    personas = personas.filter((p) => !p.needsBriefing);
  }
  const custom = Object.entries(cfg.actionTags ?? {});
  for (const [tag, re] of custom) {
    try { new RegExp(re); } catch { throw new PersonaError(`actionTags.${tag} is not a valid regex`, 'tags are matched against the lowercased input'); }
  }
  const actionTags: Array<[string, string]> = [...custom, ...DEFAULT_ACTION_TAGS.filter(([t]) => !(t in (cfg.actionTags ?? {})))];
  return {
    id: base?.id ?? 'custom',
    question: base?.question ?? 'Custom profile',
    personas: [CONTROL, ...personas],
    ...(cfg.briefing ? { briefing: cfg.briefing } : {}),
    actionTags,
    noiseFloor: cfg.noiseFloor ?? NOISE_DEFAULTS,
    notes,
  };
}

const COUNT_SIGNALS = new Set(['novelStates', 'distinctActions', 'turnsPlayed', 'turnsToFinish']);
const RATE_SIGNALS = new Set(['repeatRate', 'rejectedRate', 'offPath']);

function validateSignal(signal: string, who: string): void {
  if (COUNT_SIGNALS.has(signal) || RATE_SIGNALS.has(signal)) return;
  if (/^share:[a-z0-9-]+(,[a-z0-9-]+)*$/.test(signal)) return;
  throw new PersonaError(`${who} targets unknown signal "${signal}"`, 'use share:<tag>[,<tag>], novelStates, distinctActions, repeatRate, turnsPlayed, turnsToFinish, rejectedRate or offPath');
}

/** The full brief a seat plays: the world from config, then the style, then what it was told. */
export function composePersona(world: string, p: PersonaSpec, briefing?: string): string {
  if (!p.brief) return world;
  const told = p.needsBriefing && briefing ? `\n\nWhat you were told before you started:\n${briefing}` : '';
  return `${world}\n\nHow you play:\n${p.brief}${told}`;
}

export function tagInput(input: string, tags: Array<[string, string]>): string | null {
  const s = input.trim().toLowerCase();
  for (const [tag, re] of tags) if (new RegExp(re).test(s)) return tag;
  return null;
}

/** What one seat's run gives the signals. */
export type SeatTrace = {
  inputs: string[];
  turnsPlayed: number;
  coverage?: Coverage;
  verifiers?: VerifierReport;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** One seat's value for a signal; null when the run cannot say. */
export function signalValue(signal: Signal, t: SeatTrace, tags: Array<[string, string]>, controlInputs: Set<string>): number | null {
  const inputs = t.inputs.filter((x) => x.trim() !== '');
  if (signal.startsWith('share:')) {
    if (inputs.length === 0) return null;
    const want = new Set(signal.slice(6).split(','));
    return inputs.filter((x) => want.has(tagInput(x, tags) ?? '')).length / inputs.length;
  }
  switch (signal) {
    case 'turnsPlayed': return t.turnsPlayed;
    // A quit is not a finish. Without this, a quitter would beat the runner on
    // fewest turns. A run that hit the turn budget counts all its turns.
    case 'turnsToFinish': return inputs.length > 0 && tagInput(inputs[inputs.length - 1]!, tags) === 'quit' ? null : t.turnsPlayed;
    case 'novelStates': return t.coverage?.novelStates ?? null;
    case 'distinctActions': return t.coverage?.distinctActions ?? null;
    case 'repeatRate': return t.coverage?.repeatRate ?? null;
    case 'offPath':
      if (inputs.length === 0 || controlInputs.size === 0) return null;
      return inputs.filter((x) => !controlInputs.has(norm(x))).length / inputs.length;
    case 'rejectedRate': {
      const v = t.verifiers;
      if (!v || v.ignoredInputs.length === 0) return null;
      return rejectedTurns(v).size / v.ignoredInputs.length;
    }
  }
  return null;
}

/** Turns whose input the game refused (parser lists) or ignored (unchanged screen). */
export function rejectedTurns(v: VerifierReport): Set<number> {
  const out = new Set<number>();
  for (const x of v.ignoredInputs) if (isIgnored(x)) out.add(x.turn);
  for (const x of v.parser.turns) if (x.classification === 'unparsed' || x.classification === 'refused') out.add(x.turn);
  return out;
}

export type PersonaVerdict = 'distinct' | 'like-control' | 'not-first' | 'no-signal' | 'baseline';

export type PersonaResult = {
  id: string;
  seats: number;
  target?: Target;
  value: number | null;
  control: number | null;
  floor: number | null;
  verdict: PersonaVerdict;
  /** Every signal, for the matrix in the report. */
  signals: Record<string, number | null>;
};

export type ProfileResult = {
  profile: string;
  question: string;
  personas: PersonaResult[];
  /** Measured |replicate - control| per signal, when the profile has a replicate. */
  measuredFloor: Record<string, number> | null;
  /** Per action tag: inputs tried and inputs the game refused or ignored, over the whole profile. */
  rejectedByTag: Array<{ tag: string; tried: number; rejected: number }>;
  notes: string[];
};

const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

function floorFor(signal: string, control: number, noise: { share: number; count: number }, measured: number | undefined): number {
  const base = COUNT_SIGNALS.has(signal) ? Math.max(1, noise.count * control) : noise.share;
  // One replicate pair is a noisy floor, so it can only raise the default, never lower it.
  return measured === undefined ? base : Math.max(base, measured);
}

export function judgeProfile(profile: ResolvedProfile, traces: Record<string, SeatTrace[]>): ProfileResult {
  const signalsInPlay = [...new Set([
    'turnsPlayed', 'turnsToFinish', 'novelStates', 'repeatRate', 'rejectedRate', 'offPath',
    ...profile.personas.flatMap((p) => (p.target ? [p.target.signal] : [])),
  ])];
  const controlInputs = new Set((traces.control ?? []).flatMap((t) => t.inputs.filter((x) => x.trim() !== '').map(norm)));
  const valueOf = (id: string, signal: string) =>
    mean((traces[id] ?? []).map((t) => signalValue(signal, t, profile.actionTags, controlInputs)).filter((x): x is number => x !== null));

  const signalTable: Record<string, Record<string, number | null>> = {};
  for (const p of profile.personas) {
    signalTable[p.id] = Object.fromEntries(signalsInPlay.map((s) => [s, valueOf(p.id, s)]));
  }

  let measuredFloor: Record<string, number> | null = null;
  if (signalTable.replicate && (traces.replicate ?? []).length > 0) {
    measuredFloor = {};
    for (const s of signalsInPlay) {
      const r = signalTable.replicate[s];
      const c = signalTable.control[s];
      if (r !== null && c !== null) measuredFloor[s] = Math.abs(r - c);
    }
  }

  const contenders = profile.personas.filter((p) => p.target);
  const personas: PersonaResult[] = profile.personas.map((p) => {
    const seats = (traces[p.id] ?? []).length;
    const signals = signalTable[p.id];
    if (!p.target) return { id: p.id, seats, value: null, control: null, floor: null, verdict: 'baseline', signals };
    const { signal, direction } = p.target;
    const value = signals[signal];
    const control = signalTable.control[signal];
    if (value === null || control === null || value === undefined || control === undefined) {
      return { id: p.id, seats, target: p.target, value: value ?? null, control: control ?? null, floor: null, verdict: 'no-signal', signals };
    }
    const floor = floorFor(signal, control, profile.noiseFloor, measuredFloor?.[signal]);
    const gap = direction === 'high' ? value - control : control - value;
    let verdict: PersonaVerdict = gap >= floor ? 'distinct' : 'like-control';
    if (verdict === 'distinct') {
      const rivals = contenders.filter((o) => o.id !== p.id).map((o) => signalTable[o.id][signal]).filter((x): x is number => x !== null && x !== undefined);
      // A tie is not going further: two styles that both make no mistakes both count.
      const beaten = rivals.some((r) => (direction === 'high' ? r > value : r < value));
      if (beaten) verdict = 'not-first';
    }
    return { id: p.id, seats, target: p.target, value, control, floor, verdict, signals };
  });

  const byTag = new Map<string, { tried: number; rejected: number }>();
  for (const list of Object.values(traces)) {
    for (const t of list) {
      if (!t.verifiers) continue;
      const rejected = rejectedTurns(t.verifiers);
      for (const row of t.verifiers.ignoredInputs) {
        const tag = tagInput(row.input, profile.actionTags) ?? 'other';
        const cell = byTag.get(tag) ?? { tried: 0, rejected: 0 };
        cell.tried++;
        if (rejected.has(row.turn)) cell.rejected++;
        byTag.set(tag, cell);
      }
    }
  }
  const rejectedByTag = [...byTag.entries()]
    .map(([tag, c]) => ({ tag, ...c }))
    .sort((a, b) => b.rejected / b.tried - a.rejected / a.tried || b.tried - a.tried);

  return { profile: profile.id, question: profile.question, personas, measuredFloor, rejectedByTag, notes: profile.notes };
}

const fmt = (signal: string | undefined, x: number | null) => {
  if (x === null) return '—';
  if (signal && COUNT_SIGNALS.has(signal)) return Number.isInteger(x) ? String(x) : x.toFixed(1);
  return `${Math.round(x * 100)}%`;
};

const VERDICT_TEXT: Record<PersonaVerdict, string> = {
  distinct: '**distinct**',
  'like-control': 'played like control',
  'not-first': 'beat control, but another persona did more',
  'no-signal': 'no signal in this run',
  baseline: 'baseline',
};

export function renderProfile(name: string, label: string, r: ProfileResult): string {
  const lines: string[] = [`# ${name}: personas, \`${r.profile}\` profile (${label})`, '', `**The question:** ${r.question}`, ''];
  const judged = r.personas.filter((p) => p.target);
  const distinct = judged.filter((p) => p.verdict === 'distinct');
  lines.push(`**${distinct.length} of ${judged.length} personas played distinctly.** A persona counts only if its target signal beats control by the noise floor and no other persona in the profile went further on it. The findings of one that did not separate are control's findings under another name.`, '');
  lines.push('| persona | seats | target | value | control | floor | verdict |', '|---|---|---|---|---|---|---|');
  for (const p of r.personas) {
    const target = p.target ? `${p.target.signal} ${p.target.direction === 'high' ? '↑' : '↓'}` : '—';
    lines.push(`| ${p.id} | ${p.seats} | ${target} | ${fmt(p.target?.signal, p.value)} | ${fmt(p.target?.signal, p.control)} | ${fmt(p.target?.signal, p.floor)} | ${VERDICT_TEXT[p.verdict]} |`);
  }
  if (r.measuredFloor) {
    lines.push('', 'The floor is the larger of the default margin and the measured gap between `replicate` and `control`, which played the same brief.');
  }
  const signals = Object.keys(r.personas[0]?.signals ?? {});
  if (signals.length > 0) {
    lines.push('', '## Every signal', '', `| persona | ${signals.join(' | ')} |`, `|---|${signals.map(() => '---').join('|')}|`);
    for (const p of r.personas) lines.push(`| ${p.id} | ${signals.map((s) => fmt(s, p.signals[s])).join(' | ')} |`);
  }
  const refused = r.rejectedByTag.filter((x) => x.rejected > 0);
  if (refused.length > 0) {
    lines.push('', '## What the game refused or ignored, by kind of input', '', '| input kind | tried | refused or ignored |', '|---|---|---|');
    for (const x of refused) lines.push(`| ${x.tag} | ${x.tried} | ${x.rejected} (${Math.round((100 * x.rejected) / x.tried)}%) |`);
    lines.push('', 'A kind that players reach for and the game refuses is a missing verb, not a player mistake.');
  }
  if (r.notes.length > 0) {
    lines.push('', '## Notes', '');
    for (const n of r.notes) lines.push(`- ${n}`);
  }
  lines.push('', 'Each persona run has its own REPORT.md under `<label>--<persona>/`.', '');
  return lines.join('\n');
}
