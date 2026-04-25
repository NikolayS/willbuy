import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

function lintWebFile(relPath: string): { code: number; out: string } {
  // Use the main repo eslint config — this proves the rule is scoped to
  // apps/web/** as intended (NOT relying on the fixtures-only config).
  const result = spawnSync(
    'bunx',
    ['eslint', '--no-error-on-unmatched-pattern', '--no-ignore', relPath],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    },
  );
  return {
    code: result.status ?? -1,
    out: (result.stdout ?? '') + (result.stderr ?? ''),
  };
}

describe('apps/web lint scoping (SPEC §5.10 + issue #7 acceptance #4)', () => {
  it('rejects dangerouslySetInnerHTML inside apps/web/_lint-fixtures/dangerous.tsx', () => {
    const out = lintWebFile('apps/web/_lint-fixtures/dangerous.tsx');
    expect(out.code, `eslint should fail; got code=${out.code}\n${out.out}`).not.toBe(0);
    expect(out.out).toMatch(/no-danger/);
  });

  it('accepts ordinary JSX in apps/web/_lint-fixtures/clean.tsx', () => {
    const out = lintWebFile('apps/web/_lint-fixtures/clean.tsx');
    expect(out.code, `eslint should pass; got code=${out.code}\n${out.out}`).toBe(0);
  });
});
