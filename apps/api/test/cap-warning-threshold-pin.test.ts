/**
 * cap-warning-threshold-pin.test.ts — spec-pin for the 50% cap threshold
 * in maybeWarnCap() (spec §5.6). No DB required.
 *
 * The threshold formula `new_cents < daily_cap_cents * 0.5` is embedded
 * inside an async function that requires a DB connection. The existing
 * atomic-spend.test.ts tests it inside a describeIfDocker block. This
 * file pins the pure threshold logic via the __test__ seam.
 */

import { describe, it, expect } from 'vitest';
import { __test__ } from '../src/billing/cap-warning.js';

const { exceedsHalfCap } = __test__;

describe('50% daily cap threshold (spec §5.6)', () => {
  it('returns false when new_cents is below 50% of cap', () => {
    expect(exceedsHalfCap(49, 100)).toBe(false);
    expect(exceedsHalfCap(0, 100)).toBe(false);
  });

  it('returns true when new_cents equals exactly 50% of cap (boundary)', () => {
    expect(exceedsHalfCap(50, 100)).toBe(true);
  });

  it('returns true when new_cents exceeds 50% of cap', () => {
    expect(exceedsHalfCap(51, 100)).toBe(true);
    expect(exceedsHalfCap(100, 100)).toBe(true);
  });

  it('works with real-world cap values (daily_cap=10 000 cents = $100)', () => {
    // Below threshold
    expect(exceedsHalfCap(4_999, 10_000)).toBe(false);
    // At threshold
    expect(exceedsHalfCap(5_000, 10_000)).toBe(true);
    // Above threshold
    expect(exceedsHalfCap(5_001, 10_000)).toBe(true);
  });
});
