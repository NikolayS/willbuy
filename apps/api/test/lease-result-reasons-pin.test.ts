/**
 * lease-result-reasons-pin.test.ts — spec-pin for AcquireLeaseResult and
 * ExtendLeaseResult reason strings in backstory-lease.ts (spec §2 #12, §5.11).
 *
 * AcquireLeaseResult:  ok:true | { ok:false, reason: 'held' }
 * ExtendLeaseResult:   ok:true | { ok:false, reason: 'not_owner' | 'not_found' }
 *
 * The integration tests in leases.integration.test.ts (Docker-gated) assert:
 *   - 'held'      — concurrent acquire loser (AC2, AC7)
 *   - 'not_owner' — extend by non-holder (AC3)
 *
 * But 'not_found' (extendLease called on a non-existent lease row) is only
 * in the type definition and the return path in extendLease() — no test
 * asserts its exact string value.
 *
 * If 'not_found' is renamed (e.g. to 'missing'), callers checking
 *   `if (!result.ok && result.reason === 'not_found')`
 * would silently fall through the condition without executing the handler,
 * while TypeScript would still compile (both sides of the rename update
 * together).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  resolve(here, '..', 'src', 'leases', 'backstory-lease.ts'),
  'utf8',
);

describe('AcquireLeaseResult / ExtendLeaseResult reason spec-pin (spec §2 #12, §5.11)', () => {
  it("AcquireLeaseResult failure reason is 'held'", () => {
    expect(src).toMatch(/reason:\s*'held'/);
  });

  it("ExtendLeaseResult failure reasons include 'not_owner'", () => {
    expect(src).toMatch(/reason:\s*'not_owner'/);
  });

  it("ExtendLeaseResult failure reasons include 'not_found'", () => {
    expect(src).toMatch(/reason:\s*'not_found'/);
  });

  it("'not_found' is returned when the lease row does not exist", () => {
    // Verify the return statement exists in the function body — not just the type.
    const notFoundIdx = src.indexOf("reason: 'not_found'");
    expect(notFoundIdx).toBeGreaterThanOrEqual(0);
    // And it appears inside extendLease (after its definition).
    const extendIdx = src.indexOf('export async function extendLease');
    expect(notFoundIdx).toBeGreaterThan(extendIdx);
  });
});
