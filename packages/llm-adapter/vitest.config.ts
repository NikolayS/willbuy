import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Subprocess + timeout cases need headroom above the default 120 s adapter
    // timeout (spec §4.1 mentions 120 s default). Tests use a tighter override.
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
