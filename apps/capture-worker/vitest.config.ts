import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Capture spec §2 #6 caps wall-clock at 45 s; the breach test exercises
    // that ceiling and needs headroom above it. 90 s gives the abort path
    // room to detect + assert without flakes.
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
});
