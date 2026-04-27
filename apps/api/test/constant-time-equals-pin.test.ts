/**
 * constant-time-equals-pin.test.ts — correctness tests for
 * constantTimeEquals() (bearer-token comparison, security-critical).
 *
 * The function is exported from metrics/registry.ts but has no direct
 * unit tests. It is used in the bearer-auth path where a non-constant-time
 * comparison would be a timing oracle for API keys. Correctness tests do not
 * prove constant-time behavior (that requires hardware measurement), but they
 * do catch logical bugs that would allow prefix matches or length leaks.
 */

import { describe, it, expect } from 'vitest';
import { constantTimeEquals } from '../src/metrics/registry.js';

describe('constantTimeEquals() — correctness (bearer-token auth)', () => {
  it('returns true for two identical strings', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
  });

  it('returns false for two strings that differ in one character', () => {
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
  });

  it('returns false when one string is a prefix of the other', () => {
    expect(constantTimeEquals('abc', 'abcdef')).toBe(false);
    expect(constantTimeEquals('abcdef', 'abc')).toBe(false);
  });

  it('returns false for empty string vs non-empty', () => {
    expect(constantTimeEquals('', 'abc')).toBe(false);
    expect(constantTimeEquals('abc', '')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(constantTimeEquals('', '')).toBe(true);
  });

  it('returns false for strings that only differ in case', () => {
    expect(constantTimeEquals('ABC', 'abc')).toBe(false);
  });

  it('returns false when strings have same length but differ at start', () => {
    expect(constantTimeEquals('xbc123', 'abc123')).toBe(false);
  });

  it('returns false when strings have same length but differ at end', () => {
    expect(constantTimeEquals('abc12x', 'abc123')).toBe(false);
  });

  it('handles long strings (API key length ≥ 32 chars)', () => {
    const key = 'sk_live_' + 'A'.repeat(24);
    expect(constantTimeEquals(key, key)).toBe(true);
    expect(constantTimeEquals(key, key.slice(0, -1) + 'B')).toBe(false);
  });
});
