// vitest.config.ts — root config; workspace is defined in vitest.workspace.ts.
// Issue #61: singleThread/maxThreads=1 was here globally, serializing all
// tests. Moved to the 'migrations' project in vitest.workspace.ts so only
// tests/migrations*.test.ts serialise; all other suites run in parallel.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
  },
});
