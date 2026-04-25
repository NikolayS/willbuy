// Issue #100 — guard against migration-number collisions.
//
// Three collisions in one day (PR #89+#91 on 0014, PR #95+#96 on 0016, plus a
// near-miss on PR #82) cost a ~30-min hotfix or in-PR renumber each. This test
// pins the contract for `scripts/check-migrations.sh`:
//
//   1. Exit 0 against the current repo (no collisions, all paired, all in plan).
//   2. Exit 1 with a clear stderr message when a duplicate prefix is dropped
//      into infra/migrations/ — proven via a temp-fixture repo so the real
//      tree is never touched.
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const checkScript = resolve(repoRoot, 'scripts/check-migrations.sh');

describe('scripts/check-migrations.sh (#100)', () => {
  it('passes on the current repo', () => {
    const r = spawnSync('bash', [checkScript], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/migration-collision check: OK/);
  });

  describe('fixture: induced duplicate prefix', () => {
    let fixtureRoot: string | null = null;
    afterEach(() => {
      if (fixtureRoot !== null) {
        rmSync(fixtureRoot, { recursive: true, force: true });
        fixtureRoot = null;
      }
    });

    it('fails with exit 1 and a clear stderr message', () => {
      // Build a minimal fixture mirroring the real layout, then drop a
      // duplicate-prefix file into it. We don't mutate the real repo.
      fixtureRoot = mkdtempSync(join(tmpdir(), 'willbuy-mig-guard-'));
      // Copy infra/ into the fixture (cheap: a few KiB of .sql).
      cpSync(resolve(repoRoot, 'infra'), join(fixtureRoot, 'infra'), {
        recursive: true,
      });
      // Induce the failure mode: clone 0014_share_tokens.sql under a new
      // name with the same 4-digit prefix.
      const dupSrc = join(
        fixtureRoot,
        'infra/migrations/0014_share_tokens.sql',
      );
      const dupDst = join(fixtureRoot, 'infra/migrations/0014_dup.sql');
      writeFileSync(dupDst, readFileSync(dupSrc));

      const r = spawnSync('bash', [checkScript], {
        cwd: fixtureRoot,
        encoding: 'utf8',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/duplicate migration number prefix/i);
      expect(r.stderr).toContain('0014');
    });
  });
});
