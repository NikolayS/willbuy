/**
 * pollerLeaseTimeoutPin.test.ts — spec-pin for the '90s'
 * idle_in_transaction_session_timeout in capture-worker/src/poller.ts.
 *
 * Spec derivation (comment in poller.ts):
 *   "2× the wall-clock capture ceiling (45 s × 2 = 90 s)"
 *   = 2 × CAPTURE_CEILINGS.WALL_CLOCK_MS / 1000 = 2 × 45 = 90 s
 *
 * The '90s' timeout bounds a wedged capture: if Playwright hangs past 45 s
 * (WALL_CLOCK_MS), the capture's own ceiling fires. '90s' provides a
 * belt-and-suspenders: if THAT also fails, Postgres rolls back the
 * transaction after 90 s and releases the FOR UPDATE SKIP LOCKED row lock
 * so the sweeper can re-lease the visit.
 *
 * Risk: changing '90s' to '900s' would silently hold the row lock for 15
 * minutes on a wedged capture — blocking any other worker from picking up
 * that visit — with no other test failing.
 *
 * Pin strategy: read poller.ts source as text (same pattern as PR #442).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pollerSrc = resolve(here, '..', 'src', 'poller.ts');

describe('capture-worker poller lease timeout spec-pin (§2 #6 × 2 = 90s)', () => {
  it('poller.ts source exists', () => {
    expect(() => readFileSync(pollerSrc, 'utf8')).not.toThrow();
  });

  it("idle_in_transaction_session_timeout is set to '90s' (2× WALL_CLOCK_MS=45s)", () => {
    const src = readFileSync(pollerSrc, 'utf8');
    expect(src).toMatch(/idle_in_transaction_session_timeout\s*=\s*'90s'/);
  });

  it('the timeout SET appears after BEGIN (transaction-scoped lease)', () => {
    const src = readFileSync(pollerSrc, 'utf8');
    const beginIdx = src.indexOf("query('BEGIN')");
    const setIdx = src.indexOf("SET LOCAL idle_in_transaction_session_timeout = '90s'");
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(beginIdx);
  });
});
