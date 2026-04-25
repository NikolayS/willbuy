// vitest.workspace.ts — two projects:
//   1. migrations — singleThread=true so concurrent postgres containers don't
//      OOM-kill CI runners (issue #57). Applies only to tests/migrations*.test.ts.
//   2. rest — parallel (default pool); all other test files.
//
// Issue #61: the original vitest.config.ts applied singleThread globally,
// serializing the entire suite. Scoping it here restores parallelism for
// non-migration tests while keeping the migration serialization that #57 needed.

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'migrations',
      include: ['tests/migrations*.test.ts'],
      environment: 'node',
      testTimeout: 120_000,
      poolOptions: {
        threads: {
          singleThread: true,
          maxThreads: 1,
        },
      },
    },
  },
  {
    test: {
      name: 'rest',
      include: [
        'tests/**/*.test.ts',
        'apps/*/test/**/*.test.ts',
        'packages/*/test/**/*.test.ts',
        'infra/*/test/**/*.test.ts',
      ],
      exclude: ['tests/migrations*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
    },
  },
]);
