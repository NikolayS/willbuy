import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'infra/*/test/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 30_000,
    // Prevent concurrent Postgres containers within the migrations suite:
    // running two containers simultaneously caused OOM-kills on CI runners
    // with constrained memory budgets (issue #57).
    poolOptions: {
      threads: {
        singleThread: true,
        maxThreads: 1,
      },
    },
  },
});
