// runWithNetns.test.ts — exercises the typed worker seam (spec §5.13).
//
// We run the wrapper in `dryRun: true` mode, which:
//  - calls the real netns-bringup.sh with WILLBUY_DRY_RUN=1 (no NET_ADMIN
//    needed),
//  - skips the docker run entirely,
//  - returns the structured result the visit worker will branch on.
//
// We also assert the `NetnsBringupError.breachReason` mapping for the two
// fail-at-bring-up cases:
//   1. resolved IP is internal -> 'dns_internal'
//   2. resolved IP set exceeds host budget -> 'host_count'

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NetnsBringupError,
  parseHostBudgetOutput,
  runWithNetns,
  __test__,
} from '../src/run-with-netns.js';

const { sanitizeNetnsName, classifyBringupFailure, parseStateList, parseHost } = __test__;

const HERE = dirname(fileURLToPath(import.meta.url));
const INFRA = resolve(HERE, '..', '..', '..', 'infra', 'capture');

let tmpRoot = '';
let shimDir = '';
let stateDir = '';

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'willbuy-netns-'));
  shimDir = join(tmpRoot, 'shim');
  stateDir = join(tmpRoot, 'state');
  // mkdir
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

describe('runWithNetns (spec §5.13 dry-run path)', () => {
  it('returns ok for a public-resolved target', async () => {
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

    const result = await runWithNetns({
      captureId: 'feedfacecafe',
      targetUrl: 'http://example.com/',
      image: 'unused',
      cmd: ['echo', 'unused'],
      dryRun: true,
    });

    expect(result.status).toBe('ok');
    expect(result.netns).toBe('wb-feedfacecaf');
    expect(result.bringupExit).toBe(0);
  });

  it('throws NetnsBringupError with reason=dns_internal when target resolves to a deny CIDR', async () => {
    writeGetentShim(
      [
        '#!/usr/bin/env bash',
        'printf "169.254.169.254  STREAM rebind.example\\n"',
      ].join('\n'),
    );

    process.env.PATH = `${shimDir}:${process.env.PATH ?? ''}`;
    process.env.WILLBUY_STATE_DIR = stateDir;

    await expect(
      runWithNetns({
        captureId: 'rebind1234',
        targetUrl: 'http://rebind.example/',
        image: 'unused',
        cmd: ['echo'],
        dryRun: true,
      }),
    ).rejects.toMatchObject({
      name: 'NetnsBringupError',
      breachReason: 'dns_internal',
    });
  });

  it('throws NetnsBringupError with reason=host_count when resolved set exceeds budget', async () => {
    writeGetentShim(
      [
        '#!/usr/bin/env bash',
        'for i in $(seq 1 60); do',
        '  printf "203.0.113.%s  STREAM many.example\\n" "$i"',
        'done',
      ].join('\n'),
    );

    process.env.PATH = `${shimDir}:${process.env.PATH ?? ''}`;
    process.env.WILLBUY_STATE_DIR = stateDir;

    let caught: unknown;
    try {
      await runWithNetns({
        captureId: 'big1234',
        targetUrl: 'http://many.example/',
        image: 'unused',
        cmd: ['echo'],
        dryRun: true,
        hostBudget: 50,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NetnsBringupError);
    expect((caught as NetnsBringupError).breachReason).toBe('host_count');
  });
});

describe('parseHostBudgetOutput', () => {
  it('parses under-budget line', () => {
    expect(parseHostBudgetOutput('host_count=12')).toEqual({
      hostCount: 12,
      breached: false,
    });
  });
  it('parses over-budget line with breach reason', () => {
    expect(
      parseHostBudgetOutput('host_count=51 breach_reason=host_count'),
    ).toEqual({ hostCount: 51, breached: true });
  });
  it('throws on garbage input', () => {
    expect(() => parseHostBudgetOutput('garbage')).toThrow(/unparseable/);
  });
});

// Pin INFRA so editor auto-imports don't drop it.
void INFRA;

// ---------------------------------------------------------------------------
// Private helpers (via __test__ export)
// ---------------------------------------------------------------------------

describe('sanitizeNetnsName', () => {
  it('adds wb- prefix and keeps first 11 alnum chars', () => {
    expect(sanitizeNetnsName('feedfacecafe1234')).toBe('wb-feedfacecaf');
  });

  it('strips non-alnum non-dash non-underscore chars', () => {
    expect(sanitizeNetnsName('ab!@#cd$%^ef123')).toBe('wb-abcdef123');
  });

  it('handles a short id without padding', () => {
    expect(sanitizeNetnsName('abc')).toBe('wb-abc');
  });

  it('empty string yields just the prefix', () => {
    expect(sanitizeNetnsName('')).toBe('wb-');
  });
});

describe('classifyBringupFailure', () => {
  it('returns "dns_internal" when stderr contains the deny-range marker', () => {
    expect(classifyBringupFailure('in deny range; capture refused')).toBe('dns_internal');
  });

  it('returns "host_count" when stderr contains the budget marker', () => {
    expect(classifyBringupFailure('exceeds host budget')).toBe('host_count');
  });

  it('returns undefined for unknown stderr', () => {
    expect(classifyBringupFailure('some other error')).toBeUndefined();
  });
});

describe('parseStateList', () => {
  it('extracts comma-separated values by key', () => {
    expect(parseStateList('key=a,b,c', 'key')).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array when key is absent', () => {
    expect(parseStateList('other=x', 'key')).toEqual([]);
  });

  it('trims surrounding whitespace from each value', () => {
    expect(parseStateList('key= a , b ', 'key')).toEqual(['a', 'b']);
  });
});

describe('parseHost', () => {
  it('extracts hostname from a valid URL', () => {
    expect(parseHost('https://example.com/path')).toBe('example.com');
  });

  it('returns null for an invalid URL', () => {
    expect(parseHost('not-a-url')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseHost('')).toBeNull();
  });
});
