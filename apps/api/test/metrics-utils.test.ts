/**
 * metrics-utils.test.ts — unit tests for constantTimeEquals() from metrics/registry.ts.
 *
 * constantTimeEquals() is the timing-safe string comparator used to gate
 * the /metrics endpoint behind a bearer token. It's security-critical and
 * had no dedicated tests — it was only reachable through the full server
 * integration test which uses Fastify inject (not suitable for timing analysis).
 *
 * The correctness invariants we test here:
 *   - Equal strings → true
 *   - Unequal strings → false
 *   - Different lengths → false (short-circuit before the loop)
 *   - Empty strings → true (vacuously equal)
 *   - One empty, one non-empty → false
 *   - Strings that differ only at one position → false
 */

import { describe, expect, it } from 'vitest';
import { constantTimeEquals } from '../src/metrics/registry.js';

describe('constantTimeEquals()', () => {
  it('returns true for identical non-empty strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
  });

  it('returns false for strings that differ in content', () => {
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
  });

  it('returns false when strings have different lengths', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('abcd', 'abc')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(constantTimeEquals('', '')).toBe(true);
  });

  it('returns false for one empty and one non-empty string', () => {
    expect(constantTimeEquals('', 'a')).toBe(false);
    expect(constantTimeEquals('a', '')).toBe(false);
  });

  it('returns false when strings differ only at the last character', () => {
    expect(constantTimeEquals('abcx', 'abcy')).toBe(false);
  });

  it('returns false when strings differ only at the first character', () => {
    expect(constantTimeEquals('xbc', 'ybc')).toBe(false);
  });

  it('handles long strings that are identical', () => {
    const s = 'A'.repeat(256);
    expect(constantTimeEquals(s, s)).toBe(true);
  });

  it('handles long strings that differ at one byte', () => {
    const a = 'A'.repeat(256);
    const b = 'A'.repeat(255) + 'B';
    expect(constantTimeEquals(a, b)).toBe(false);
  });
});
