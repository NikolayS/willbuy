/**
 * captureCeilingsPin.test.ts — spec-pin for all CAPTURE_CEILINGS values
 * (spec §2 #6). No browser or fixture server needed.
 *
 * The existing captureCeilings.test.ts only pins TOTAL_BYTES (25 MB).
 * This file pins the remaining four constants so a silent spec deviation
 * is caught without running the full integration suite.
 *
 * Spec refs:
 *   §2 #5 — distinct-host budget ≤ 50.
 *   §2 #6 — wall_clock ≤ 45s, total_bytes ≤ 25 MB, dom_nodes ≤ 250 000,
 *            a11y_tree_bytes ≤ 10 MB.
 */

import { describe, it, expect } from 'vitest';
import { CAPTURE_CEILINGS } from '../src/types.js';

describe('CAPTURE_CEILINGS spec-pin (spec §2 #5, §2 #6)', () => {
  it('WALL_CLOCK_MS is 45 000 ms (45 s)', () => {
    expect(CAPTURE_CEILINGS.WALL_CLOCK_MS).toBe(45_000);
  });

  it('TOTAL_BYTES is 25 MB', () => {
    expect(CAPTURE_CEILINGS.TOTAL_BYTES).toBe(25 * 1024 * 1024);
  });

  it('DOM_NODES is 250 000', () => {
    expect(CAPTURE_CEILINGS.DOM_NODES).toBe(250_000);
  });

  it('A11Y_TREE_BYTES is 10 MB', () => {
    expect(CAPTURE_CEILINGS.A11Y_TREE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('HOST_COUNT is 50 (spec §2 #5)', () => {
    expect(CAPTURE_CEILINGS.HOST_COUNT).toBe(50);
  });

  it('has exactly 5 ceiling keys', () => {
    expect(Object.keys(CAPTURE_CEILINGS)).toHaveLength(5);
  });

  it('all ceiling values are positive integers', () => {
    for (const [key, value] of Object.entries(CAPTURE_CEILINGS)) {
      expect(Number.isInteger(value), `${key}: not an integer`).toBe(true);
      expect(value > 0, `${key}: not positive`).toBe(true);
    }
  });
});
