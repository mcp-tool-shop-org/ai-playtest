import { describe, it, expect } from 'vitest';
import { actionToLine, describeActions, type Action, type ActionSpace } from './driver.js';

describe('actionToLine', () => {
  it.each([
    [{ kind: 'line', line: 'go north' }, 'go north'],
    [{ kind: 'key', key: 'y' }, 'y'],
    [{ kind: 'choose', id: '1' }, '1'],
    [{ kind: 'call', name: 'look' }, 'look'],
    [{ kind: 'call', name: 'take', args: { item: 'lamp' } }, 'take {"item":"lamp"}'],
  ] as Array<[Action, string]>)('renders %j as %j', (action, line) => {
    expect(actionToLine(action)).toBe(line);
  });
});

describe('describeActions', () => {
  it('returns empty for undefined and free-text', () => {
    expect(describeActions(undefined)).toBe('');
    expect(describeActions({ kind: 'free-text' })).toBe('');
  });

  it.each([
    [{ kind: 'keys', keys: ['w', 'a', 's', 'd'] }, 'Keys you may press: w a s d'],
    [
      { kind: 'choice', options: [{ id: '1', label: 'Attack' }, { id: '2', label: 'Flee' }] },
      'Choose one:\n  1) Attack\n  2) Flee',
    ],
    [
      { kind: 'schema', schema: { type: 'object' } },
      'Reply with one call from this schema:\n{"type":"object"}',
    ],
  ] as Array<[ActionSpace, string]>)('describes %j', (space, text) => {
    expect(describeActions(space)).toBe(text);
  });
});
