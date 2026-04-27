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
  checkRedirectAllowed,
  parseHostBudgetOutput,
  runWithNetns,
} from '../src/run-with-netns.js';

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

// ── checkRedirectAllowed ──────────────────────────────────────────────────────

describe('checkRedirectAllowed', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'wb-check-redirect-'));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('returns { allowed: false, reason: "no_state" } when state file is missing', async () => {
    const result = await checkRedirectAllowed('wb-abc12345678', 'https://example.com', stateDir);
    expect(result).toEqual({ allowed: false, reason: 'no_state' });
  });

  it('returns { allowed: false, reason: "bad_url" } for a malformed redirect URL', async () => {
    writeFileSync(join(stateDir, 'wb-abc12345678.state'), 'allowed_ipv4=1.2.3.4\n');
    const result = await checkRedirectAllowed('wb-abc12345678', 'not-a-url', stateDir);
    expect(result).toEqual({ allowed: false, reason: 'bad_url' });
  });

  it('returns { allowed: false, reason: "dns_fail" } when host does not resolve', async () => {
    // Using a guaranteed-unresolvable hostname (RFC 2606 .invalid TLD) so DNS
    // lookup throws ENOTFOUND and the function returns dns_fail without mocking.
    writeFileSync(join(stateDir, 'wb-abc12345678.state'), 'allowed_ipv4=1.2.3.4\n');
    const result = await checkRedirectAllowed(
      'wb-abc12345678',
      'https://this-hostname-definitely-does-not.exist.invalid',
      stateDir,
    );
    expect(result).toEqual({ allowed: false, reason: 'dns_fail' });
  });
});
