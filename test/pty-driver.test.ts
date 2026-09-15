import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { createPtyDriver } from '../src/pty-driver.js';
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
});
