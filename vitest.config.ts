import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
// ci.yml sets COVERAGE_LEG to 'true' on the run whose reports go to Codecov.
// That run collects coverage, adds an lcov report, and writes JUnit test
// results; CI runs Vitest through npm run verify, where no flag on the step
// reaches it. Every other run is unchanged.
const coverageLeg = process.env.COVERAGE_LEG === 'true';
// The coverage block no-ops when the provider package is missing so `vitest run`
// stays green where the dev dependencies were not installed.
let coverage: {
  enabled: boolean;
  provider: 'v8';
  reporter?: string[];
  include: string[];
  exclude: string[];
  thresholds: { lines: number; functions: number; branches: number };
} | undefined;
try {
  require.resolve('@vitest/coverage-v8');
  coverage = {
    enabled: coverageLeg,
    provider: 'v8',
    ...(coverageLeg ? { reporter: ['text', 'html', 'clover', 'json', 'lcovonly'] } : {}),
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
    ...(coverageLeg ? { reporters: ['default', 'junit'], outputFile: { junit: 'junit.xml' } } : {}),
    // JS console only. ConPTY child stderr still inherits fd 2 (see pty-driver.test.ts).
    onConsoleLog(log: string) {
      if (/AttachConsole|conpty_console_list_agent|getConsoleProcessList/i.test(log)) return false;
    },
    ...(coverage ? { coverage } : {}),
  },
});


