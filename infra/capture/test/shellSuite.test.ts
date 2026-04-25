// shellSuite.test.ts — wraps the bash-level acceptance suites so they run
// inside the standard `bun run test` flow on every CI runner.
//
// What this proves:
//  - infra/capture/test/dryrun.test.sh exits 0 (default-deny ruleset shape).
//  - infra/capture/test/cidr.test.sh exits 0 (CIDR membership oracle).
//  - infra/capture/test/redirect.test.sh exits 0 (cross-eTLD+1 re-check parser).
//
// What this does NOT prove:
//  - End-to-end netns + iptables behavior. That requires NET_ADMIN and runs
//    in the dedicated `egress-integration` job (.github/workflows/ci.yml).

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITES = ['dryrun.test.sh', 'cidr.test.sh', 'redirect.test.sh'] as const;

describe('infra/capture egress shell suites (spec §5.13 + §2 #5)', () => {
  for (const suite of SUITES) {
    it(`${suite} passes`, () => {
      const script = resolve(HERE, suite);
      const result = spawnSync('bash', [script], {
        encoding: 'utf8',
        // Hermetic: no inherited PATH games, no env leakage.
        env: {
          ...process.env,
          // Force a known shell path for portability across macOS / Linux runners.
          BASH_ENV: '',
        },
      });
      if (result.status !== 0) {
        // Surface stdout + stderr verbatim so the failing assertion is
        // readable in the vitest report.
        const blob = `\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`;
        throw new Error(`${suite} exited ${result.status}${blob}`);
      }
      expect(result.status).toBe(0);
    }, 30_000);
  }
});

// Sanity: the privileged suite exists and is executable, even though we
// don't run it here.
describe('infra/capture egress privileged suite presence', () => {
  it('privileged.test.sh exists and is executable', () => {
    const script = resolve(HERE, 'privileged.test.sh');
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });
});

// Pin the join import so editor auto-imports don't drop it.
void join;
