/**
 * lease-report-constants-pin.test.ts — spec-pin for backstory lease backoff
 * constants and report route cookie cap (no DB required).
 *
 * Spec refs:
 *   §2 S2-6 / §5.11 — backoff: 100 ms base, ×4 factor, 3 tries max.
 *   §2 #20           — report share-token cookie cap: 2 hours (7200 s).
 */

import { describe, it, expect } from 'vitest';
import { __test__ as leaseTest } from '../src/leases/backstory-lease.js';
import { __test__ as reportsTest } from '../src/routes/reports.js';

const { BACKOFF_BASE_MS, BACKOFF_FACTOR, BACKOFF_MAX_TRIES } = leaseTest;
const { MAX_COOKIE_SECONDS } = reportsTest;

describe('Backstory lease backoff constants (spec §2 S2-6, §5.11)', () => {
  it('BACKOFF_BASE_MS is 100 ms', () => {
    expect(BACKOFF_BASE_MS).toBe(100);
  });

  it('BACKOFF_FACTOR is 4', () => {
    expect(BACKOFF_FACTOR).toBe(4);
  });

  it('BACKOFF_MAX_TRIES is 3', () => {
    expect(BACKOFF_MAX_TRIES).toBe(3);
  });

  it('backoff sequence: base=100, ×4 each step → 100/400/1600 ms', () => {
    expect(BACKOFF_BASE_MS).toBe(100);
    expect(BACKOFF_BASE_MS * BACKOFF_FACTOR).toBe(400);
    expect(BACKOFF_BASE_MS * BACKOFF_FACTOR * BACKOFF_FACTOR).toBe(1_600);
  });
});

describe('Report share-token cookie cap (spec §2 #20)', () => {
  it('MAX_COOKIE_SECONDS is 7200 (2 hours)', () => {
    expect(MAX_COOKIE_SECONDS).toBe(2 * 60 * 60);
    expect(MAX_COOKIE_SECONDS).toBe(7_200);
  });
});
