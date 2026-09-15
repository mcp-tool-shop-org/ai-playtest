import { describe, it, expect, vi } from 'vitest';

// Stub the optional TUI dep so this file exercises the load-failure path even
// on a machine where @xterm/headless is installed. Live ConPTY tests stay in
// pty-driver.test.ts behind describe.skipIf.
vi.mock('@xterm/headless', () => ({ default: {}, Terminal: undefined }));

import { createPtyDriver, PtyUnavailableError } from '../src/pty-driver.js';

describe('PtyUnavailableError', () => {
  it('exposes code E_PTY_UNAVAILABLE and a hint naming node-pty', () => {
    const err = new PtyUnavailableError(
      'install the optional deps: npm install node-pty @xterm/headless (node-pty has no Linux prebuild and will compile there)',
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('E_PTY_UNAVAILABLE');
    expect(err.hint).toMatch(/node-pty/);
  });

  it('is thrown from createPtyDriver when the optional import cannot provide a Terminal', async () => {
    await expect(createPtyDriver({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      promptPatterns: ['>'],
      promptQuietMs: 10,
      idleQuietMs: 20,
      screenTimeoutMs: 100,
    })).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(PtyUnavailableError);
      expect((err as PtyUnavailableError).code).toBe('E_PTY_UNAVAILABLE');
      expect((err as PtyUnavailableError).hint).toMatch(/node-pty/);
      return true;
    });
  });
});
