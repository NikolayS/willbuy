import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // Integration test suites each spin up their own Docker-backed Postgres
    // container. Run files sequentially to avoid Docker port collisions and
    // resource contention on CI and local machines.
    fileParallelism: false,
  },
});
