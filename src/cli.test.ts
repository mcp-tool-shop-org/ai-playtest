import { describe, it, expect } from 'vitest';
import { usage } from './cli.js';

describe('cli usage', () => {
  it('names --runs, --serial, seat ids, and the exit-code contract', () => {
    const u = usage();
    expect(u).toMatch(/--runs/);
    expect(u).toMatch(/--serial/);
    expect(u).toMatch(/seat id/);
    expect(u).toMatch(/Exit codes/);
    expect(u).toMatch(/check <config\.json>/);
  });
});
