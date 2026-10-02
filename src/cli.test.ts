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

  it('documents diff, its acceptance file and exit code 5', () => {
    const u = usage();
    expect(u).toMatch(/diff <config\.json> --base <label> --head <label> \[--accept <file>\]/);
    expect(u).toMatch(/5 diff found open regressions/);
  });
});
