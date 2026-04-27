/**
 * api-key-helpers.test.ts — unit tests for the key-generation helpers in
 * routes/api-keys.ts (spec §2 #21, §5.12 — key format + masking).
 *
 * generateKey and maskKey are security-related functions: the key format
 * must match the hard-coded prefix and length spec, and the masking must
 * never leak more than the last 4 chars.
 *
 * Tests:
 *   generateKey:
 *     1. Returns a string starting with the "sk_live_" prefix.
 *     2. Total length is PREFIX.length + KEY_BODY_LEN.
 *     3. Each call returns a unique key (random body).
 *     4. Body contains only BASE62-safe characters (no special chars).
 *   maskKey:
 *     5. Returns "***" + last 4 chars.
 *     6. Works for a key that is exactly 4 chars long.
 *     7. Empty string → "***".
 *   Constants spec-pin:
 *     8. PREFIX is "sk_live_".
 *     9. KEY_BODY_LEN is 24.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/routes/api-keys.js';

const { generateKey, maskKey, PREFIX, KEY_BODY_LEN } = __test__;

describe('generateKey', () => {
  it('starts with the "sk_live_" prefix', () => {
    expect(generateKey()).toMatch(/^sk_live_/);
  });

  it('has total length PREFIX.length + KEY_BODY_LEN', () => {
    const key = generateKey();
    expect(key.length).toBe(PREFIX.length + KEY_BODY_LEN);
  });

  it('produces a unique key on every call', () => {
    const keys = new Set(Array.from({ length: 10 }, () => generateKey()));
    expect(keys.size).toBe(10);
  });

  it('body uses only BASE62 characters (A-Z, a-z, 0-9)', () => {
    const body = generateKey().slice(PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe('maskKey', () => {
  it('returns "***" + last 4 characters', () => {
    expect(maskKey('sk_live_ABCDEFGHIJKLMNOP1234')).toBe('***1234');
  });

  it('masks a key that is exactly 4 characters long', () => {
    expect(maskKey('abcd')).toBe('***abcd');
  });

  it('handles an empty string without throwing', () => {
    expect(maskKey('')).toBe('***');
  });
});

describe('api-key constants spec-pin', () => {
  it('PREFIX is "sk_live_"', () => {
    expect(PREFIX).toBe('sk_live_');
  });

  it('KEY_BODY_LEN is 24', () => {
    expect(KEY_BODY_LEN).toBe(24);
  });
});
