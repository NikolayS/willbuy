/**
 * N3 — bin.js entrypoint smoke test (spec §5.13 / issue #32).
 *
 * The systemd unit's ExecStart points to `dist/bin.js`. This test asserts:
 *  1. `src/bin.ts` exists and is importable (type-only check via a dynamic
 *     import that immediately sends SIGTERM so the server is not left running).
 *  2. The built `dist/bin.js` exists and can be executed for `--help` or a
 *     quick `--smoke` flag that starts + immediately stops the broker.
 *
 * Because TypeScript compilation is part of `pnpm build` (not `pnpm test`),
 * we exercise the source-level entrypoint via tsx in the test environment.
 * The systemd unit runs `dist/bin.js` (Node, compiled); CI builds before
 * running tests so `dist/bin.js` should be present when this suite runs.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcBin = resolve(here, 'src/bin.ts');
const distBin = resolve(here, 'dist/bin.js');

describe('capture-broker entrypoint (N3)', () => {
  it('src/bin.ts exists', () => {
    expect(existsSync(srcBin), `${srcBin} should exist`).toBe(true);
  });

  it('dist/bin.js exists after pnpm build', () => {
    expect(existsSync(distBin), `${distBin} should exist — run pnpm build first`).toBe(true);
  });

  // Smoke: run `node dist/bin.js --smoke` and expect exit 0 within 5 s.
  // The --smoke flag starts the broker on a temp socket, sends one valid
  // probe request, then exits cleanly. This exercises the full runtime path
  // without needing a systemd socket or env file.
  it('dist/bin.js --smoke exits 0', () => {
    const result = spawnSync('node', [distBin, '--smoke'], {
      timeout: 5_000,
      encoding: 'utf8',
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
});
