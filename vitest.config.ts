import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
// @vitest/coverage-v8 is not in this package.json (shared with other domains).
// The coverage block no-ops when the provider package is missing so `vitest run`
// stays green; `vitest run --coverage` still needs the dep installed separately.
let coverage: {
  provider: 'v8';
  include: string[];
  exclude: string[];
  thresholds: { lines: number; functions: number; branches: number };
} | undefined;
try {
  require.resolve('@vitest/coverage-v8');
  coverage = {
    provider: 'v8',
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.test.ts'],
    thresholds: { lines: 70, functions: 70, branches: 60 },
  };
} catch {
  coverage = undefined;
}

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    // JS console only. ConPTY child stderr still inherits fd 2 (see pty-driver.test.ts).
    onConsoleLog(log: string) {
      if (/AttachConsole|conpty_console_list_agent|getConsoleProcessList/i.test(log)) return false;
    },
    ...(coverage ? { coverage } : {}),
  },
});


