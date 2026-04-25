import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // Run test files sequentially to avoid Docker port collisions between
    // integration test suites that each spin up their own Postgres container.
    fileParallelism: false,
  },
});
