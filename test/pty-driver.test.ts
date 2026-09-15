import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { createPtyDriver, type PtyDriverOptions } from '../src/pty-driver.js';
import { stripAnsi } from '../src/stdio-game.js';

const TUI = resolve(__dirname, 'fixtures', 'tui-game.mjs');

// node-pty is an optional dependency and ships no Linux prebuild, so on a
// machine that could not build it these are skipped rather than failed -- the
// pty driver is an optional capability and the suite should say so plainly.
let available = true;
try {
  await import('node-pty');
  await import('@xterm/headless');
} catch {
  available = false;
}

describe.skipIf(!available)('pty driver', () => {
  async function drive() {
    return createPtyDriver({
      command: process.execPath,
      args: [TUI],
      promptPatterns: ['What do you do\\?\\s*$'],
      promptQuietMs: 150,
      idleQuietMs: 2500,
      screenTimeoutMs: 15000,
      actions: { kind: 'choice', options: [{ id: '1', label: 'Attack' }, { id: '2', label: 'Flee' }, { id: '3', label: 'Look' }] },
    });
  }

  it('observes a redrawing TUI as one current screen, not stacked copies', async () => {
    const d = await drive();
    const first = await d.start();
    expect(first.reason).toBe('prompt');
    expect(first.text).toContain('== CHAPEL NAVE ==');
    expect(first.text).toContain('HP [####------] 40/100');
    expect(first.text).toContain('[1] Attack');

    const second = await d.step({ kind: 'choose', id: '1' });
    // The whole point: after a redraw the observation holds ONE HP value, the
    // current one. A line-append reader would hold both 40/100 and 30/100 and
    // the model would have to guess which is live.
    expect(second.text).toContain('HP [###-------] 30/100');
    expect(second.text).not.toContain('40/100');
    expect(second.text).toContain('Last: attacked');

    const third = await d.step({ kind: 'choose', id: '1' });
    expect(third.text).toContain('20/100');
    expect(third.text).not.toContain('30/100');
    await d.stop();
  }, 30000);

  it('exposes a grid, a cursor and the alternate-screen flag', async () => {
    const d = await drive();
    const obs = await d.start();
    expect(obs.grid).toBeDefined();
    expect(obs.grid!.altScreen).toBe(true);
    expect(obs.grid!.lines.length).toBeGreaterThan(0);
    expect(obs.grid!.cursor.y).toBeGreaterThan(0);
    // The grid is already rendered text: no escape bytes survive into it.
    expect(obs.text).not.toContain('');
    expect(stripAnsi(obs.text)).toBe(obs.text);
    await d.stop();
  }, 30000);

  it('carries the action space so an illegal action can be caught before a turn is spent', async () => {
    const d = await drive();
    const obs = await d.start();
    expect(obs.actions).toEqual({
      kind: 'choice',
      options: [{ id: '1', label: 'Attack' }, { id: '2', label: 'Flee' }, { id: '3', label: 'Look' }],
    });
    await d.stop();
  }, 30000);

  it('reports the game exiting', async () => {
    const d = await drive();
    await d.start();
    const obs = await d.step({ kind: 'line', line: 'quit' });
    expect(obs.done).toBe(true);
    expect(obs.reason).toBe('exit');
    await d.stop();
  }, 30000);

  async function driveMode(mode: string, over: Partial<PtyDriverOptions> = {}) {
    return createPtyDriver({
      command: process.execPath,
      args: [TUI, mode],
      promptPatterns: ['NEVER_MATCH_PROMPT_xyzzy\\s*$'],
      promptQuietMs: 80,
      idleQuietMs: 2500,
      screenTimeoutMs: 8000,
      ...over,
    });
  }

  it('reports sentinel when the child prints the configured token', async () => {
    // Gate: deleting `if (sawSentinel) { ... return observe('sentinel') }` makes this RED
    // (reason falls through to idle).
    const d = await driveMode('sentinel', { readySentinel: 'READY_SENTINEL_9f3e', idleQuietMs: 2500 });
    try {
      const obs = await d.start();
      expect(obs.reason).toBe('sentinel');
      expect(obs.text).toContain('READY_SENTINEL_9f3e');
    } finally {
      await d.stop();
    }
  }, 5000);

  it('reports ready-signal when the child enables bracketed paste and no prompt matches', async () => {
    // Gate: deleting `if (bracketedPaste && quiet >= opts.promptQuietMs) return observe('ready-signal')`
    // makes this RED (reason becomes 'idle' after idleQuietMs).
    const d = await driveMode('ready-signal', { promptQuietMs: 80, idleQuietMs: 2500 });
    try {
      const obs = await d.start();
      expect(obs.reason).toBe('ready-signal');
    } finally {
      await d.stop();
    }
  }, 5000);

  it('reports idle when output is quiet and no prompt, sentinel, or ready-signal matches', async () => {
    // Gate: deleting `if (quiet >= opts.idleQuietMs) return observe('idle')` makes this RED
    // (reason becomes 'timeout' at screenTimeoutMs).
    const d = await driveMode('idle', { idleQuietMs: 200, screenTimeoutMs: 8000 });
    try {
      const obs = await d.start();
      expect(obs.reason).toBe('idle');
      expect(obs.text).toContain('ruined chapel');
    } finally {
      await d.stop();
    }
  }, 5000);

  it('reports timeout when the child stays silent, and waitForTurn returns rather than spinning', async () => {
    // Gate: deleting `if (Date.now() - started > opts.screenTimeoutMs) return observe('timeout')`
    // makes this RED (reason becomes 'idle' after idleQuietMs, or the for(;;) loop never returns).
    const t0 = Date.now();
    const d = await driveMode('timeout', { idleQuietMs: 10_000, screenTimeoutMs: 400 });
    try {
      const obs = await d.start();
      expect(obs.reason).toBe('timeout');
      expect(Date.now() - t0).toBeLessThan(3000);
    } finally {
      await d.stop();
    }
  }, 5000);
});
