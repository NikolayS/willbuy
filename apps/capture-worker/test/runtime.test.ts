// runtime.test.ts — exercises the WILLBUY_CAPTURE_RUNTIME dispatcher
// (issue #116, spec §5.13 v0.1→v0.2 transport-agnostic seam).
//
// Scope of THIS PR (the dispatcher seam only):
//   - default (env unset) → 'netns' is selected,
//   - 'netns' value preserves existing run-with-netns.ts behavior,
//   - 'firecracker' value selects a stubbed runtime that throws
//     RuntimeNotImplementedError (jailer/vsock land in #117),
//   - any other value throws RuntimeConfigError at startup-time validation
//     (NOT at first request).
//
// We do NOT exercise the actual firecracker VM bring-up here — that's #117.
// We DO assert that the netns path is unchanged via a dry-run smoke that
// reuses the same shim pattern as runWithNetns.test.ts.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RuntimeConfigError,
  RuntimeNotImplementedError,
  runCapture,
  selectRuntime,
  selectRuntimeFromEnv,
} from '../src/runtime.js';

let tmpRoot = '';
let shimDir = '';
let stateDir = '';

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'willbuy-runtime-'));
  shimDir = join(tmpRoot, 'shim');
  stateDir = join(tmpRoot, 'state');
  spawnSync('mkdir', ['-p', shimDir, stateDir]);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeGetentShim(body: string): void {
  const path = join(shimDir, 'getent');
  writeFileSync(path, body, 'utf8');
  chmodSync(path, 0o755);
}

describe('selectRuntime (startup validation)', () => {
  it('defaults to "netns" when env is unset', () => {
    expect(selectRuntime(undefined)).toBe('netns');
  });

  it('defaults to "netns" when env is empty string', () => {
    expect(selectRuntime('')).toBe('netns');
  });

  it('returns "netns" for explicit netns', () => {
    expect(selectRuntime('netns')).toBe('netns');
  });

  it('returns "firecracker" for explicit firecracker', () => {
    expect(selectRuntime('firecracker')).toBe('firecracker');
  });

  it('throws RuntimeConfigError on unknown value', () => {
    let caught: unknown;
    try {
      selectRuntime('docker');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeConfigError);
    expect((caught as RuntimeConfigError).message).toMatch(
      /WILLBUY_CAPTURE_RUNTIME/,
    );
  });

  it('throws RuntimeConfigError on garbage', () => {
    expect(() => selectRuntime('xyz123')).toThrow(RuntimeConfigError);
  });

  it('is case-sensitive (rejects FIRECRACKER, NetNS, etc.)', () => {
    expect(() => selectRuntime('FIRECRACKER')).toThrow(RuntimeConfigError);
    expect(() => selectRuntime('NetNS')).toThrow(RuntimeConfigError);
  });
});

describe('runCapture dispatcher', () => {
  it('netns path: returns ok for a public-resolved target (existing behavior preserved)', async () => {
    writeGetentShim(
      [
        '#!/usr/bin/env bash',
        'case "$2" in',
        '  example.com)',
        '    printf "203.0.113.10  STREAM example.com\\n"',
        '    ;;',
        '  *)',
        '    exit 2',
        '    ;;',
        'esac',
      ].join('\n'),
    );

    process.env.PATH = `${shimDir}:${process.env.PATH ?? ''}`;
    process.env.WILLBUY_STATE_DIR = stateDir;

    const result = await runCapture(
      {
        captureId: 'feedfacecafe',
        targetUrl: 'http://example.com/',
        image: 'unused',
        cmd: ['echo', 'unused'],
        dryRun: true,
      },
      'netns',
    );

    expect(result.status).toBe('ok');
    expect(result.netns).toBe('wb-feedfacecaf');
    expect(result.bringupExit).toBe(0);
  });

  it('firecracker path: throws RuntimeNotImplementedError (stub seam for #117)', async () => {
    let caught: unknown;
    try {
      await runCapture(
        {
          captureId: 'feedfacecafe',
          targetUrl: 'http://example.com/',
          image: 'unused',
          cmd: ['echo', 'unused'],
          dryRun: true,
        },
        'firecracker',
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeNotImplementedError);
    expect((caught as RuntimeNotImplementedError).runtime).toBe('firecracker');
    expect((caught as RuntimeNotImplementedError).message).toMatch(
      /firecracker/i,
    );
  });

  it('firecracker error preserves its name for log-grep matching', async () => {
    try {
      await runCapture(
        {
          captureId: 'fc-stub',
          targetUrl: 'http://example.com/',
          image: 'unused',
          cmd: ['echo'],
          dryRun: true,
        },
        'firecracker',
      );
      // Should not reach here.
      expect.fail('expected RuntimeNotImplementedError');
    } catch (e) {
      expect((e as Error).name).toBe('RuntimeNotImplementedError');
    }
  });

  it('defaults to netns when no runtime override is passed', async () => {
    writeGetentShim(
      [
        '#!/usr/bin/env bash',
        'printf "203.0.113.20  STREAM default.example\\n"',
      ].join('\n'),
    );
    process.env.PATH = `${shimDir}:${process.env.PATH ?? ''}`;
    process.env.WILLBUY_STATE_DIR = stateDir;

    const result = await runCapture({
      captureId: 'defaulted',
      targetUrl: 'http://default.example/',
      image: 'unused',
      cmd: ['echo'],
      dryRun: true,
    });

    expect(result.status).toBe('ok');
  });
});

describe('selectRuntimeFromEnv()', () => {
  it('reads WILLBUY_CAPTURE_RUNTIME from the provided env object', () => {
    expect(selectRuntimeFromEnv({ WILLBUY_CAPTURE_RUNTIME: 'netns' })).toBe('netns');
    expect(selectRuntimeFromEnv({ WILLBUY_CAPTURE_RUNTIME: 'firecracker' })).toBe('firecracker');
  });

  it('defaults to "netns" when WILLBUY_CAPTURE_RUNTIME is unset', () => {
    expect(selectRuntimeFromEnv({})).toBe('netns');
  });

  it('throws RuntimeConfigError for an unknown WILLBUY_CAPTURE_RUNTIME value', () => {
    expect(() => selectRuntimeFromEnv({ WILLBUY_CAPTURE_RUNTIME: 'docker' })).toThrow(RuntimeConfigError);
  });
});
