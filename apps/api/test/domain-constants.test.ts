/**
 * domain-constants.test.ts — spec-pin tests for constants in routes/domains.ts.
 *
 * TOKEN_LENGTH (22): verify tokens are 22-char nanoid values (≈131 bits of
 * entropy). Changing this breaks existing tokens in the DB and leaks security
 * surface. Spec §2 #1 notes the token is a "22-char nanoid".
 *
 * PROBE_TIMEOUT_MS (5000): each domain-verification probe is bounded at 5 s
 * per spec (AC9 in the integration test asserts the route returns within ~6s).
 * Lengthening this silently breaks the latency budget.
 *
 * normalizeEtldPlusOne: domain validation boundary — same __test__ export
 * covers it here and in the normalizeEtldPlusOne-only PR for coverage
 * completeness.
 *
 * Tests:
 *   1. TOKEN_LENGTH is 22.
 *   2. PROBE_TIMEOUT_MS is 5000.
 *   3. normalizeEtldPlusOne returns eTLD+1 for a valid domain.
 *   4. normalizeEtldPlusOne returns null for empty string.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/routes/domains.js';

const { TOKEN_LENGTH, PROBE_TIMEOUT_MS, normalizeEtldPlusOne } = __test__;

describe('domain constants spec-pin (spec §2 #1)', () => {
  it('TOKEN_LENGTH is 22 (22-char nanoid per spec §2 #1)', () => {
    expect(TOKEN_LENGTH).toBe(22);
  });

  it('PROBE_TIMEOUT_MS is 5000 (5 s per probe timeout per AC9)', () => {
    expect(PROBE_TIMEOUT_MS).toBe(5000);
  });
});

describe('normalizeEtldPlusOne sanity', () => {
  it('extracts eTLD+1 from a valid domain', () => {
    expect(normalizeEtldPlusOne('sub.example.com')).toBe('example.com');
  });

  it('returns null for empty string', () => {
    expect(normalizeEtldPlusOne('')).toBeNull();
  });
});
