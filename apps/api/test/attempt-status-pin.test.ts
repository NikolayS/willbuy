/**
 * attempt-status-pin.test.ts — spec-pin for AttemptStatus values in
 * apps/api/src/billing/provider-attempts.ts (spec §2 #15, §16).
 *
 * AttemptStatus = 'started' | 'ended' | 'indeterminate' | 'indeterminate_refunded'
 *
 * These four strings are the lifecycle states of provider_attempts rows:
 *
 *   'started'               — written before the outbound provider call
 *                             (write-before-call invariant, spec §16)
 *   'ended'                 — normal completion; actual cost written
 *   'indeterminate'         — timeout/reset; outcome unknown; pessimistic
 *                             ceiling debited (spec §2 #15)
 *   'indeterminate_refunded'— written by the daily reconciliation job
 *                             when the provider confirms the call was never
 *                             executed; cost refunded
 *
 * The 'started' and 'ended' values are verified via the Docker-gated
 * integration tests in atomic-spend.test.ts. The 'indeterminate' and
 * 'indeterminate_refunded' values are only in the TypeScript type —
 * no test asserts their exact string value. If either is renamed (e.g.
 * 'indeterminate_refunded' → 'indeterminate_refund'), reconciliation
 * queries looking for `status = 'indeterminate_refunded'` would silently
 * return zero rows, and refunded credits would never be written.
 *
 * TypeScript ensures internal consistency but a coordinated rename
 * (type + all usages) compiles cleanly — hence this pin.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  resolve(here, '..', 'src', 'billing', 'provider-attempts.ts'),
  'utf8',
);

describe('AttemptStatus spec-pin (spec §2 #15 / §16 — provider-attempt lifecycle)', () => {
  it("includes 'started' (write-before-call invariant)", () => {
    expect(src).toContain("'started'");
  });

  it("includes 'ended' (normal completion)", () => {
    expect(src).toContain("'ended'");
  });

  it("includes 'indeterminate' (timeout/reset — pessimistic debit)", () => {
    expect(src).toContain("'indeterminate'");
  });

  it("includes 'indeterminate_refunded' (reconciliation credit-back)", () => {
    expect(src).toContain("'indeterminate_refunded'");
  });

  it('AttemptStatus type has exactly 4 members', () => {
    const typeDecl = src.slice(
      src.indexOf('AttemptStatus ='),
      src.indexOf(';', src.indexOf('AttemptStatus =')),
    );
    const members = typeDecl.match(/'[^']+'/g) ?? [];
    expect(members).toHaveLength(4);
  });
});
