import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Issue #5 acceptance #6: a custom ESLint rule shipped from this package
// (and enabled in the root config) bans the reserved continuation
// identifiers from spec §2 #15 ANYWHERE in the repo (one allow-list line
// for the rule definition itself). The rule must walk the TS AST so it
// catches matches in type definitions, object literals, function params,
// and destructures — not just at LLM call sites.

const here = dirname(fileURLToPath(import.meta.url));
// Root of the repo: tests live at packages/llm-adapter/test, so up three.
const repoRoot = resolve(here, '..', '..', '..');

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

describe('willbuy/no-reserved-llm-identifiers — forbidden fixtures', () => {
  it('flags a top-level `const session_id = …` declaration', () => {
    const out = lintFile('packages/llm-adapter/lint-fixtures/forbidden-identifier.ts');
    expect(out.code, `expected non-zero; got ${out.code}\n${out.stdout}\n${out.stderr}`).not.toBe(0);
    expect(out.stdout + out.stderr).toMatch(/no-reserved-llm-identifiers/);
    expect(out.stdout + out.stderr).toMatch(/session_id/);
  });

  it('flags `conversation_id` in a TS interface property', () => {
    const out = lintFile('packages/llm-adapter/lint-fixtures/forbidden-in-type.ts');
    expect(out.code, `expected non-zero; got ${out.code}\n${out.stdout}\n${out.stderr}`).not.toBe(0);
    expect(out.stdout + out.stderr).toMatch(/no-reserved-llm-identifiers/);
    expect(out.stdout + out.stderr).toMatch(/conversation_id/);
  });

  it('flags `thread_id` as an object-literal property', () => {
    const out = lintFile('packages/llm-adapter/lint-fixtures/forbidden-in-object.ts');
    expect(out.code, `expected non-zero; got ${out.code}\n${out.stdout}\n${out.stderr}`).not.toBe(0);
    expect(out.stdout + out.stderr).toMatch(/no-reserved-llm-identifiers/);
    expect(out.stdout + out.stderr).toMatch(/thread_id/);
  });

  it('flags `previous_response_id` as a function parameter', () => {
    const out = lintFile('packages/llm-adapter/lint-fixtures/forbidden-in-param.ts');
    expect(out.code, `expected non-zero; got ${out.code}\n${out.stdout}\n${out.stderr}`).not.toBe(0);
    expect(out.stdout + out.stderr).toMatch(/no-reserved-llm-identifiers/);
    expect(out.stdout + out.stderr).toMatch(/previous_response_id/);
  });

  it('flags `run_id` inside an object destructure', () => {
    const out = lintFile('packages/llm-adapter/lint-fixtures/forbidden-in-destructure.ts');
    expect(out.code, `expected non-zero; got ${out.code}\n${out.stdout}\n${out.stderr}`).not.toBe(0);
    expect(out.stdout + out.stderr).toMatch(/no-reserved-llm-identifiers/);
    expect(out.stdout + out.stderr).toMatch(/run_id/);
  });
});

describe('willbuy/no-reserved-llm-identifiers — clean fixture', () => {
  it('accepts a module with visit_id / logical_request_key / transport_attempts', () => {
    const out = lintFile('packages/llm-adapter/lint-fixtures/clean.ts');
    expect(out.code, `expected zero; got ${out.code}\n${out.stdout}\n${out.stderr}`).toBe(0);
  });
});
