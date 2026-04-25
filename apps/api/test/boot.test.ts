import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');

function bootWithEnv(env: Record<string, string | undefined>) {
  return spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: { ...env, PATH: process.env['PATH'] ?? '' },
    timeout: 15_000,
  });
}

describe('boot env validation (CLAUDE.md: zod at boundaries)', () => {
  it('exits non-zero when URL_HASH_SALT is missing', () => {
    const res = bootWithEnv({});
    expect(res.status).not.toBe(0);
    expect((res.stderr ?? '') + (res.stdout ?? '')).toMatch(/URL_HASH_SALT/);
  });

  it('exits non-zero when URL_HASH_SALT is shorter than 32 chars', () => {
    const res = bootWithEnv({ URL_HASH_SALT: 'short' });
    expect(res.status).not.toBe(0);
    expect((res.stderr ?? '') + (res.stdout ?? '')).toMatch(/URL_HASH_SALT/);
  });
});
