import { describe, it, expect } from 'vitest';
import {
  PROFILES, CONTROL, DEFAULT_ACTION_TAGS, resolveProfile, composePersona, tagInput, signalValue,
  rejectedTurns, judgeProfile, renderProfile, PersonaError, type SeatTrace, type ResolvedProfile,
} from './personas.js';
import type { VerifierReport } from './verifiers.js';
import { validatePersonas, ConfigError } from './config.js';
import type { Coverage } from './coverage.js';

const verifiers = (rows: Array<[string, 'changed' | 'identical-screen' | 'no-output']>, parser: Array<'unparsed' | 'refused' | 'accepted' | 'unknown'> = []): VerifierReport => ({
  absorbing: null,
  ignoredInputs: rows.map(([input, kind], i) => ({ turn: i + 1, input, kind })),
  parser: { turns: parser.map((classification, i) => ({ turn: i + 1, input: rows[i]?.[0] ?? '', classification })), unknownRate: 0, listsEmpty: parser.length === 0 },
  terminal: { kind: 'none', turn: null, inAbsorbingComponent: false },
  noProgress: [], entityLeads: [], stateInvariants: { applied: false, hpNegative: [], inventoryDropped: [] },
});

const coverage = (o: Partial<Coverage>): Coverage => ({
  turns: 10, novelStates: 5, turnOfLastNovelState: 5, noveltyHalfLife: 3, repeatRate: 0.1, loopRate: 0, selfLoopRate: 0,
  actionEntropy: 2, distinctActions: 5, confidence: 'moderate', notes: [], ...o,
});

const trace = (inputs: string[], o: Partial<SeatTrace> = {}): SeatTrace => ({
  inputs, turnsPlayed: inputs.length, coverage: coverage({}), verifiers: verifiers(inputs.map((x) => [x, 'changed'])), ...o,
});

describe('the built-in profiles', () => {
  it('give every persona a play style and a target unique within its profile', () => {
    for (const p of Object.values(PROFILES)) {
      const targets = p.personas.filter((x) => x.target).map((x) => x.target!.signal);
      expect(new Set(targets).size, p.id).toBe(targets.length);
      for (const x of p.personas) if (x.target) expect(x.brief.length, x.id).toBeGreaterThan(20);
      expect(() => resolveProfile({ profile: p.id, briefing: 'Find the seal and leave.' })).not.toThrow();
    }
  });

  it('keep briefs free of mechanics: no persona names a command to type', () => {
    for (const p of Object.values(PROFILES)) for (const x of p.personas) expect(x.brief, x.id).not.toMatch(/`|type "/);
  });
});

describe('resolveProfile', () => {
  it('puts control first and keeps the profile order', () => {
    const r = resolveProfile({ profile: 'bughunter' });
    expect(r.personas.map((p) => p.id)).toEqual(['control', 'cartographer', 'closer', 'boundary-pusher', 'continuity-auditor']);
    expect(r.question).toBe('What is broken?');
    expect(r.noiseFloor).toEqual({ share: 0.1, count: 0.2 });
  });

  it('leaves out the briefed persona without a briefing, and says why', () => {
    const r = resolveProfile({ profile: 'scientific' });
    expect(r.personas.map((p) => p.id)).toEqual(['control', 'replicate', 'novice', 'systematic']);
    expect(r.notes[0]).toMatch(/briefed left out/);
    expect(resolveProfile({ profile: 'scientific', briefing: 'Win.' }).personas.map((p) => p.id)).toContain('briefed');
  });

  it('narrows with only, adds custom personas, and builds a custom profile from add alone', () => {
    expect(resolveProfile({ profile: 'player', only: ['reader', 'control'] }).personas.map((p) => p.id)).toEqual(['control', 'reader']);
    const pacifist = { id: 'pacifist', brief: 'You avoid every fight you can, whatever it costs.', target: { signal: 'share:fight', direction: 'low' as const } };
    expect(resolveProfile({ profile: 'gaming', add: [pacifist] }).personas.at(-1)!.id).toBe('pacifist');
    const custom = resolveProfile({ profile: 'custom', add: [pacifist] });
    expect(custom).toMatchObject({ id: 'custom', question: 'Custom profile' });
    expect(custom.personas.map((p) => p.id)).toEqual(['control', 'pacifist']);
  });

  it('puts the game\'s own action tags ahead of the defaults, replacing one of the same name', () => {
    const r = resolveProfile({ profile: 'player', actionTags: { talk: '^(hail|parley)\\b', dance: '^dance\\b' } });
    expect(r.actionTags.slice(0, 2)).toEqual([['talk', '^(hail|parley)\\b'], ['dance', '^dance\\b']]);
    expect(r.actionTags.filter(([t]) => t === 'talk')).toHaveLength(1);
  });

  it('refuses what would make the separation test meaningless', () => {
    const bad = (cfg: Parameters<typeof resolveProfile>[0], re: RegExp) => expect(() => resolveProfile(cfg)).toThrow(re);
    bad({ profile: 'nope' }, /unknown persona profile/);
    bad({ profile: 'player', only: ['ghost'] }, /unknown persona: ghost/);
    bad({ profile: 'player', add: [{ id: 'reader', brief: 'Another reader, with the same id.' }] }, /used twice/);
    bad({ profile: 'player', add: [{ id: 'Bad Id', brief: 'x' }] }, /not usable/);
    bad({ profile: 'player', add: [{ id: 'skimmer', brief: 'You read nothing at all, ever.', target: { signal: 'share:talk,examine', direction: 'low' } }] }, /both target share:talk,examine/);
    bad({ profile: 'custom', add: [{ id: 'x', brief: 'A style.', target: { signal: 'vibes', direction: 'high' } }] }, /unknown signal "vibes"/);
    bad({ profile: 'player', actionTags: { talk: '(' } }, /not a valid regex/);
    expect(() => resolveProfile({ profile: 'nope' })).toThrow(PersonaError);
  });
});

describe('composePersona', () => {
  it('leaves control as the world brief alone, and appends a style and a briefing', () => {
    expect(composePersona('You are a courier in Harrow.', CONTROL)).toBe('You are a courier in Harrow.');
    const briefed = PROFILES.scientific.personas.find((p) => p.id === 'briefed')!;
    const s = composePersona('You are a courier in Harrow.', briefed, 'Find the seal before dusk.');
    expect(s).toMatch(/^You are a courier in Harrow\.\n\nHow you play:\n/);
    expect(s).toMatch(/What you were told before you started:\nFind the seal before dusk\.$/);
    const reader = PROFILES.player.personas.find((p) => p.id === 'reader')!;
    expect(composePersona('W', reader, 'ignored for a persona that does not need it')).not.toContain('told');
  });
});

describe('tagInput', () => {
  it('matches in order, so "run away" is flee before "run" is move', () => {
    expect(tagInput('Run away!', DEFAULT_ACTION_TAGS)).toBe('flee');
    expect(tagInput('run north', DEFAULT_ACTION_TAGS)).toBe('move');
    expect(tagInput('  ASK the warden about the seal', DEFAULT_ACTION_TAGS)).toBe('talk');
    expect(tagInput('talk:mira', DEFAULT_ACTION_TAGS)).toBe('talk');
    expect(tagInput('xyzzy', DEFAULT_ACTION_TAGS)).toBeNull();
  });
});

describe('signalValue', () => {
  const tags = DEFAULT_ACTION_TAGS;
  const control = new Set(['look', 'go north']);

  it('computes shares over non-empty inputs', () => {
    const t = trace(['talk to sela', 'look', 'go north', '']);
    expect(signalValue('share:talk,examine', t, tags, control)).toBeCloseTo(2 / 3);
    expect(signalValue('share:talk', trace([]), tags, control)).toBeNull();
  });

  it('reads coverage and turn counts, and is null where the run cannot say', () => {
    const t = trace(['look'], { coverage: coverage({ novelStates: 9, distinctActions: 4, repeatRate: 0.3 }), turnsPlayed: 12 });
    expect(signalValue('novelStates', t, tags, control)).toBe(9);
    expect(signalValue('distinctActions', t, tags, control)).toBe(4);
    expect(signalValue('repeatRate', t, tags, control)).toBe(0.3);
    expect(signalValue('turnsPlayed', t, tags, control)).toBe(12);
    expect(signalValue('novelStates', trace(['look'], { coverage: undefined }), tags, control)).toBeNull();
    expect(signalValue('mystery', t, tags, control)).toBeNull();
  });

  it('measures off-path inputs against what control typed', () => {
    expect(signalValue('offPath', trace(['LOOK', 'combine rope and hook']), tags, control)).toBe(0.5);
    expect(signalValue('offPath', trace(['look']), tags, new Set())).toBeNull();
    expect(signalValue('offPath', trace([]), tags, control)).toBeNull();
  });

  it('counts an input as rejected when it was ignored or the parser refused it, once', () => {
    const v = verifiers([['xyzzy', 'identical-screen'], ['go west', 'changed'], ['look', 'changed']], ['unparsed', 'refused', 'accepted']);
    expect([...rejectedTurns(v)].sort()).toEqual([1, 2]);
    expect(signalValue('rejectedRate', trace(['xyzzy', 'go west', 'look'], { verifiers: v }), tags, control)).toBeCloseTo(2 / 3);
    expect(signalValue('rejectedRate', trace(['x'], { verifiers: undefined }), tags, control)).toBeNull();
    expect(signalValue('rejectedRate', trace([], { verifiers: verifiers([]) }), tags, control)).toBeNull();
  });
});

describe('judgeProfile', () => {
  const profile = (id: string, extra: Partial<Parameters<typeof resolveProfile>[0]> = {}) => resolveProfile({ profile: id, ...extra });

  it('calls a persona distinct only when it beats control by the floor and leads the profile', () => {
    const r = judgeProfile(profile('player', { only: ['reader', 'tinkerer', 'runner'] }), {
      control: [trace(['look', 'go north', 'go north', 'look'])],
      reader: [trace(['talk to sela', 'read notice', 'ask about seal', 'go north'])],
      tinkerer: [trace(['look', 'go north', 'look', 'go north'])],
      runner: [trace(['go north', 'go east'])],
    });
    const v = Object.fromEntries(r.personas.map((p) => [p.id, p.verdict]));
    expect(v).toEqual({ control: 'baseline', reader: 'distinct', tinkerer: 'like-control', runner: 'distinct' });
    const reader = r.personas.find((p) => p.id === 'reader')!;
    expect(reader).toMatchObject({ value: 0.75, control: 0.5, floor: 0.1, seats: 1 });
  });

  it('marks a persona that beat control but lost its own signal to another persona', () => {
    // continuity-auditor targets examine/talk; cartographer is not a rival there, so give a custom rival.
    const p = resolveProfile({
      profile: 'custom',
      add: [
        { id: 'talker', brief: 'You talk to everyone you meet.', target: { signal: 'share:talk', direction: 'high' } },
        { id: 'looker', brief: 'You look closely at everything.', target: { signal: 'share:examine', direction: 'high' } },
      ],
    });
    const r = judgeProfile(p, {
      control: [trace(['go north', 'go north'])],
      talker: [trace(['talk to a', 'look'])],
      looker: [trace(['talk to a', 'talk to b'])],
    });
    expect(r.personas.find((x) => x.id === 'talker')!.verdict).toBe('not-first');
  });

  it('uses the replicate gap as the floor when it is larger than the default', () => {
    const r = judgeProfile(profile('scientific'), {
      control: [trace(['look', 'look', 'look', 'look'], { coverage: coverage({ repeatRate: 0.1 }) })],
      replicate: [trace(['look', 'look', 'look', 'look'], { coverage: coverage({ repeatRate: 0.4 }) })],
      novice: [trace(['look', 'look'])],
      systematic: [trace(['look', 'look'], { coverage: coverage({ repeatRate: 0.45 }) })],
    });
    expect(r.measuredFloor!.repeatRate).toBeCloseTo(0.3);
    const sys = r.personas.find((p) => p.id === 'systematic')!;
    expect(sys.floor).toBeCloseTo(0.3);
    expect(sys.verdict).toBe('distinct');
    expect(r.personas.find((p) => p.id === 'replicate')!.verdict).toBe('baseline');
  });

  it('sets a count floor relative to control, never under one', () => {
    const r = judgeProfile(profile('bughunter', { only: ['cartographer'] }), {
      control: [trace(['look'], { coverage: coverage({ novelStates: 2 }) })],
      cartographer: [trace(['go north'], { coverage: coverage({ novelStates: 3 }) })],
    });
    const c = r.personas.find((p) => p.id === 'cartographer')!;
    expect(c.floor).toBe(1);
    expect(c.verdict).toBe('distinct');
  });

  it('says so when a persona has no signal, or never ran', () => {
    const r = judgeProfile(profile('player', { only: ['reader', 'grinder'] }), {
      control: [trace([])],
      reader: [trace(['talk to sela'])],
    });
    const v = Object.fromEntries(r.personas.map((p) => [p.id, [p.verdict, p.seats]]));
    expect(v.reader).toEqual(['no-signal', 1]);
    expect(v.grinder).toEqual(['no-signal', 0]);
  });

  it('tallies what the game refused by kind of input across the whole profile', () => {
    const r = judgeProfile(profile('gaming', { only: ['genre-veteran'] }), {
      control: [trace(['look', 'go north'])],
      'genre-veteran': [trace(['save', 'status', 'look'], { verifiers: verifiers([['save', 'identical-screen'], ['status', 'identical-screen'], ['look', 'changed']]) })],
    });
    expect(r.rejectedByTag.slice(0, 2)).toEqual([{ tag: 'save', tried: 1, rejected: 1 }, { tag: 'menu', tried: 1, rejected: 1 }]);
    expect(r.rejectedByTag.find((x) => x.tag === 'examine')).toEqual({ tag: 'examine', tried: 2, rejected: 0 });
  });
});

describe('renderProfile', () => {
  const p: ResolvedProfile = resolveProfile({ profile: 'scientific' });
  const r = judgeProfile(p, {
    control: [trace(['look', 'go north'], { verifiers: verifiers([['look', 'changed'], ['go north', 'identical-screen']]) })],
    replicate: [trace(['look', 'go north'])],
    novice: [trace(['look'])],
    systematic: [trace(['look', 'look'], { coverage: coverage({ repeatRate: 0.9 }) })],
  });
  const md = renderProfile('Harrow Gate', 'L', r);

  it('states the question, the count of distinct personas and each verdict', () => {
    expect(md).toContain('# Harrow Gate: personas, `scientific` profile (L)');
    expect(md).toContain('**The question:** Can these readings be trusted on this game?');
    expect(md).toMatch(/\*\*\d of 2 personas played distinctly\.\*\*/);
    expect(md).toContain('| systematic | 1 | repeatRate ↑ | 90% | 10% | 10% | **distinct** |');
    expect(md).toContain('| control | 1 | — | — | — | — | baseline |');
  });

  it('explains the measured floor, shows every signal, the refused inputs and the notes', () => {
    expect(md).toContain('measured gap between `replicate` and `control`');
    expect(md).toContain('## Every signal');
    expect(md).toContain('| move | 2 | 1 (50%) |');
    expect(md).toContain('briefed left out');
  });

  it('leaves out the sections with nothing in them', () => {
    const bare = renderProfile('G', 'L', judgeProfile(resolveProfile({ profile: 'player', only: ['reader'] }), { control: [trace(['look'])], reader: [trace(['talk'])] }));
    expect(bare).not.toContain('What the game refused');
    expect(bare).not.toContain('## Notes');
    expect(bare).not.toContain('measured gap');
  });
});

describe('validatePersonas (config)', () => {
  it('accepts a profile with narrowing, extra personas, a briefing, tags and a floor', () => {
    const out = validatePersonas({
      profile: 'scientific',
      only: ['novice', 'briefed'],
      add: [{ id: 'pacifist', brief: 'You avoid every fight you can.', target: { signal: 'share:fight', direction: 'low' }, needsBriefing: true }],
      briefing: 'Find the seal and leave before dusk.',
      actionTags: { talk: '^(hail|parley)\b' },
      noiseFloor: { share: 0.15, count: 0.25 },
    });
    expect(out).toMatchObject({ profile: 'scientific', only: ['novice', 'briefed'], briefing: 'Find the seal and leave before dusk.', noiseFloor: { share: 0.15, count: 0.25 } });
    expect(out.add![0]).toEqual({ id: 'pacifist', brief: 'You avoid every fight you can.', target: { signal: 'share:fight', direction: 'low' }, needsBriefing: true });
  });

  it('refuses malformed shapes with a hint, and reports a bad profile as a config error', () => {
    const bad = (raw: unknown, re: RegExp) => expect(() => validatePersonas(raw)).toThrow(re);
    bad('player', /must be an object/);
    bad({}, /profile missing/);
    bad({ profile: 'player', extra: 1 }, /unknown/i);
    bad({ profile: 'player', add: {} }, /add must be an array/);
    bad({ profile: 'player', add: [{ id: 'x' }] }, /needs an id and a brief/);
    bad({ profile: 'player', add: [{ id: 'x', brief: 'A style.' }] }, /needs a target/);
    bad({ profile: 'player', add: [{ id: 'x', brief: 'A style.', target: { signal: 'share:fight', direction: 'sideways' } }] }, /needs a target/);
    bad({ profile: 'player', briefing: '' }, /briefing must be a non-empty string/);
    bad({ profile: 'player', actionTags: { talk: 3 } }, /map tag names to regex strings/);
    bad({ profile: 'player', noiseFloor: { share: 2, count: 0.2 } }, /noiseFloor/);
    expect(() => validatePersonas({ profile: 'astrology' })).toThrow(ConfigError);
    expect(() => validatePersonas({ profile: 'astrology' })).toThrow(/personas: unknown persona profile/);
  });
});
