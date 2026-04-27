/**
 * backoff.test.ts — unit tests for the jittered exponential backoff helpers
 * in leases/backstory-lease.ts (spec §2 S2-6 — 100ms→400ms→1.6s retry cadence).
 *
 * These constants define the lease-acquisition retry behaviour for the
 * visitor-worker. A silent change could either cause too-aggressive retries
 * (thundering herd) or too-slow fallback (starving a study).
 *
 * Tests:
 *   Constants spec-pin:
 *     1. BACKOFF_BASE_MS is 100.
 *     2. BACKOFF_FACTOR is 4.
 *     3. BACKOFF_MAX_TRIES is 3.
 *   jitter:
 *     4. Returns a value within ±20% of the input (inclusive).
 *     5. Returns exactly the input when Math.random() yields the midpoint.
 *   backoffMs:
 *     6. Attempt 0 → base range [80, 120] ms (100ms ±20%).
 *     7. Attempt 1 → base range [320, 480] ms (400ms ±20%).
 *     8. Attempt 2 → base range [1280, 1920] ms (1600ms ±20%).
 */

import { describe, expect, it, vi } from 'vitest';
import { __test__ } from '../src/leases/backstory-lease.js';

const { BACKOFF_BASE_MS, BACKOFF_FACTOR, BACKOFF_MAX_TRIES, backoffMs, jitter } = __test__;

describe('backoff constants spec-pin (spec §2 S2-6)', () => {
  it('BACKOFF_BASE_MS is 100', () => {
    expect(BACKOFF_BASE_MS).toBe(100);
  });

  it('BACKOFF_FACTOR is 4', () => {
    expect(BACKOFF_FACTOR).toBe(4);
  });

  it('BACKOFF_MAX_TRIES is 3', () => {
    expect(BACKOFF_MAX_TRIES).toBe(3);
  });
});

describe('jitter', () => {
  it('returns a value within ±20% of the input (inclusive bounds)', () => {
    for (let i = 0; i < 50; i++) {
      const v = jitter(1000);
      expect(v).toBeGreaterThanOrEqual(800);
      expect(v).toBeLessThanOrEqual(1200);
    }
  });

  it('returns input×0.8 when Math.random() returns 0 (lower bound)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(jitter(1000)).toBeCloseTo(800);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('backoffMs ranges', () => {
  it('attempt 0: result is within [80, 120] ms', () => {
    for (let i = 0; i < 20; i++) {
      const v = backoffMs(0);
      expect(v).toBeGreaterThanOrEqual(80);
      expect(v).toBeLessThanOrEqual(120);
    }
  });

  it('attempt 1: result is within [320, 480] ms', () => {
    for (let i = 0; i < 20; i++) {
      const v = backoffMs(1);
      expect(v).toBeGreaterThanOrEqual(320);
      expect(v).toBeLessThanOrEqual(480);
    }
  });

  it('attempt 2: result is within [1280, 1920] ms', () => {
    for (let i = 0; i < 20; i++) {
      const v = backoffMs(2);
      expect(v).toBeGreaterThanOrEqual(1280);
      expect(v).toBeLessThanOrEqual(1920);
    }
  });
});
