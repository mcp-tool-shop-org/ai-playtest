import { describe, it, expect } from 'vitest';
import { sanitizeInput, buildPlayerMessages, PLAYER_SYSTEM_PREFIX, chooseInput, nextFallback, PLAYER_FALLBACKS } from './player.js';
import type { ChatClient } from './openrouter.js';
import type { TurnRecord } from './player.js';

const fallbackTurn = (turn: number, input: string): TurnRecord => ({
  turn,
  screen: 's',
  input,
  reason: 'prompt',
  ms: 1,
  fallback: true,
});

describe('sanitizeInput', () => {
  it('keeps a plain line', () => expect(sanitizeInput('attack the stalker')).toBe('attack the stalker'));
  it('strips quotes, fences, and a leading prompt marker', () => {
    expect(sanitizeInput('"look around"')).toBe('look around');
    expect(sanitizeInput('```\ngo north\n```')).toBe('go north');
    expect(sanitizeInput('> talk to the pilgrim')).toBe('talk to the pilgrim');
  });
  // Gate: deleting `.replace(/^\[[A-Z]+\]\s*/, '')` makes '[ACTION] go north' RED.
  // Gate: deleting the single-quote / backtick wrap clause makes those rows RED.
  it.each([
    ['[ACTION] go north', 'go north'],
    ["'go north'", 'go north'],
    ['`go north`', 'go north'],
    ["'go north", "'go north"],
    ['```javascript\ngo north\n```', 'go north'],
  ] as const)('maps %j to %j so a clause cannot be deleted silently', (input, expected) => {
    expect(sanitizeInput(input)).toBe(expected);
  });
  it('takes the first non-empty line of a multi-line answer', () => {
    expect(sanitizeInput('\n\nlook\nI think this is wise.')).toBe('look');
  });
  it('falls back to look on an empty answer and caps length', () => {
    // Pin: sanitizeInput still maps blank to 'look'. Product empty path is chooseInput + nextFallback.
    expect(sanitizeInput(' ')).toBe('look');
    expect(sanitizeInput('   ')).toBe('look');
    expect(sanitizeInput('x'.repeat(500)).length).toBe(200);
  });
});

describe('nextFallback', () => {
  it('rotates look → wait → help → look across consecutive fallbacks', () => {
    expect(PLAYER_FALLBACKS).toEqual(['look', 'wait', 'help']);
    expect(nextFallback([])).toBe('look');
    expect(nextFallback([fallbackTurn(1, 'look')])).toBe('wait');
    expect(nextFallback([fallbackTurn(1, 'look'), fallbackTurn(2, 'wait')])).toBe('help');
    expect(nextFallback([fallbackTurn(1, 'look'), fallbackTurn(2, 'wait'), fallbackTurn(3, 'help')])).toBe('look');
  });
});

describe('chooseInput', () => {
  const opts = { memoryTurns: 3, screenChars: 6000, temperature: 0.2 };

  it('flags fallback and rotates when the model returns blank or an empty fence', async () => {
    const replies = ['   ', '```\n```'];
    let i = 0;
    const client: ChatClient = async () => replies[i++] ?? '   ';

    const first = await chooseInput(client, 'fake/model', 'wanderer', [], 'You are in a dark room.', opts);
    expect(first.input).toBe('look');
    expect(first.fallback).toBe(true);
    expect(first.rawSnippet).toBeDefined();

    const history: TurnRecord[] = [{
      turn: 1,
      screen: 'You are in a dark room.',
      input: first.input,
      reason: 'prompt',
      ms: 1,
      fallback: first.fallback,
      rawSnippet: first.rawSnippet,
    }];
    const second = await chooseInput(client, 'fake/model', 'wanderer', history, 'Still dark.', opts);
    expect(second.input).toBe('wait');
    expect(second.fallback).toBe(true);
  });
});

describe('buildPlayerMessages', () => {
  it('carries the persona in the system prompt, the last N turns, and the current screen', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ turn: i + 1, screen: `screen ${i + 1}`, input: `input ${i + 1}`, reason: 'prompt', ms: 1 }));
    const msgs = buildPlayerMessages('You are a cautious wanderer.', history, 'current screen', 3, 6000);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain(PLAYER_SYSTEM_PREFIX.slice(0, 40));
    expect(msgs[0].content).toContain('cautious wanderer');
    // 3 remembered turns = 6 messages + the current screen
    expect(msgs.length).toBe(1 + 6 + 1);
    expect(msgs[1].content).toBe('screen 10');
    expect(msgs[msgs.length - 1].content).toBe('current screen');
  });
  it('clips a long screen from the front and says so', () => {
    const msgs = buildPlayerMessages('p'.repeat(30), [], 'a'.repeat(100) + 'TAIL', 0, 50);
    const last = msgs[msgs.length - 1].content;
    expect(last).toMatch(/earlier characters trimmed/);
    expect(last.endsWith('TAIL')).toBe(true);
  });
});
