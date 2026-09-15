import { describe, it, expect } from 'vitest';
import { actionToLine, actionFromInput, validateAction, ActionError, describeActions, type Action, type ActionSpace } from './driver.js';

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

describe('actionFromInput', () => {
  const choice: ActionSpace = { kind: 'choice', options: [{ id: 'attack', label: 'Attack' }, { id: 'flee', label: 'Flee' }] };
  const keys: ActionSpace = { kind: 'keys', keys: ['w', 'a', 's', 'd'] };

  it('maps a choice id or label onto choose, and a miss onto line', () => {
    expect(actionFromInput('attack', choice)).toEqual({ kind: 'choose', id: 'attack' });
    expect(actionFromInput('Flee', choice)).toEqual({ kind: 'choose', id: 'flee' });
    expect(actionFromInput('nope', choice)).toEqual({ kind: 'line', line: 'nope' });
  });

  it('maps a listed key onto key, anything else onto line', () => {
    expect(actionFromInput('w', keys)).toEqual({ kind: 'key', key: 'w' });
    expect(actionFromInput('look', keys)).toEqual({ kind: 'line', line: 'look' });
    expect(actionFromInput('go north', undefined)).toEqual({ kind: 'line', line: 'go north' });
    expect(actionFromInput('go north', { kind: 'free-text' })).toEqual({ kind: 'line', line: 'go north' });
  });
});

describe('validateAction', () => {
  const choice: ActionSpace = { kind: 'choice', options: [{ id: 'attack', label: 'Attack' }] };
  const keys: ActionSpace = { kind: 'keys', keys: ['w', 'a'] };

  it('passes free-text and a missing space', () => {
    expect(() => validateAction(undefined, { kind: 'line', line: 'look' })).not.toThrow();
    expect(() => validateAction({ kind: 'free-text' }, { kind: 'line', line: 'look' })).not.toThrow();
  });

  it('throws E_ACTION on a closed-set miss', () => {
    expect(() => validateAction(choice, { kind: 'choose', id: 'flee' })).toThrow(ActionError);
    expect(() => validateAction(keys, { kind: 'key', key: 'x' })).toThrow(ActionError);
    try {
      validateAction(choice, { kind: 'line', line: 'attack' });
    } catch (err) {
      expect(err).toMatchObject({ code: 'E_ACTION' });
    }
  });
});
