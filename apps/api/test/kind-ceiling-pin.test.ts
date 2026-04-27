/**
 * kind-ceiling-pin.test.ts — spec-pin for KIND_CEILING values (no DB required).
 *
 * Spec refs:
 *   §5.5 — per-kind hard ceilings: visit=5¢, cluster_label=3¢, embedding=0¢, probe=0¢.
 *
 * KIND_CEILING is already exported from atomic-spend.ts; no seam needed.
 */

import { describe, it, expect } from 'vitest';
import { KIND_CEILING } from '../src/billing/atomic-spend.js';

describe('KIND_CEILING — spec §5.5 per-kind hard ceilings', () => {
  it('visit ceiling is 5 cents', () => {
    expect(KIND_CEILING.visit).toBe(5);
  });

  it('cluster_label ceiling is 3 cents', () => {
    expect(KIND_CEILING.cluster_label).toBe(3);
  });

  it('embedding ceiling is 0 cents', () => {
    expect(KIND_CEILING.embedding).toBe(0);
  });

  it('probe ceiling is 0 cents', () => {
    expect(KIND_CEILING.probe).toBe(0);
  });

  it('has exactly 4 kind entries', () => {
    expect(Object.keys(KIND_CEILING)).toHaveLength(4);
  });

  it('all ceiling values are non-negative integers', () => {
    for (const [kind, cents] of Object.entries(KIND_CEILING)) {
      expect(Number.isInteger(cents), `${kind}: not an integer`).toBe(true);
      expect(cents >= 0, `${kind}: negative ceiling`).toBe(true);
    }
  });
});
