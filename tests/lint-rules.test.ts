import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function lintFile(relPath: string): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'eslint',
      '--config',
      'eslint.fixtures.config.mjs',
      '--no-error-on-unmatched-pattern',
      relPath,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    },
  );
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('repo lint rules', () => {
  it('rejects the literal "--no-sandbox" anywhere in the source tree', () => {
    const out = lintFile('tests/lint-fixtures/banned-sandbox-flag.ts');
    expect(out.code, `eslint should fail; got code=${out.code}\n${out.stdout}\n${out.stderr}`).not.toBe(0);
    expect(out.stdout + out.stderr).toMatch(/no-sandbox/);
  });

  it('rejects dangerouslySetInnerHTML in JSX (react/no-danger)', () => {
    const out = lintFile('tests/lint-fixtures/dangerously-set.tsx');
    expect(out.code, `eslint should fail; got code=${out.code}\n${out.stdout}\n${out.stderr}`).not.toBe(0);
    expect(out.stdout + out.stderr).toMatch(/no-danger/);
  });
});
