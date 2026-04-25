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
  },
});
