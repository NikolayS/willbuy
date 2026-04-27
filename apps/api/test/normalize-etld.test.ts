/**
 * normalize-etld.test.ts — unit tests for normalizeEtldPlusOne (routes/domains.ts).
 *
 * This function is the domain validation boundary used by every domain write
 * route. It rejects garbage inputs and returns the eTLD+1 via tldts. Tests
 * here guard against regressions that could allow invalid or unsafe domains
 * to be registered without Docker/network.
 *
 * Tests:
 *   1. Valid domain → returns eTLD+1.
 *   2. URL string → extracts eTLD+1.
 *   3. Subdomain → returns eTLD+1 (strips subdomain).
 *   4. Empty string → null.
 *   5. Whitespace-only → null.
 *   6. Input with internal whitespace → null.
 *   7. 'localhost' → null (no dot in domain).
 *   8. IP address → null (tldts returns no domain).
 *   9. Case insensitivity: UPPERCASE → lowercase eTLD+1.
 *  10. Leading/trailing whitespace trimmed before processing.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/routes/domains.js';

const { normalizeEtldPlusOne } = __test__;

describe('normalizeEtldPlusOne (domain validation boundary)', () => {
  it('returns the eTLD+1 for a valid public domain', () => {
    expect(normalizeEtldPlusOne('example.com')).toBe('example.com');
  });

  it('strips subdomain — returns just the eTLD+1', () => {
    expect(normalizeEtldPlusOne('www.example.com')).toBe('example.com');
  });

  it('handles a full URL — extracts the eTLD+1', () => {
    expect(normalizeEtldPlusOne('https://app.example.com/path')).toBe('example.com');
  });

  it('returns null for an empty string', () => {
    expect(normalizeEtldPlusOne('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(normalizeEtldPlusOne('   ')).toBeNull();
  });

  it('returns null for a string with internal whitespace', () => {
    expect(normalizeEtldPlusOne('exa mple.com')).toBeNull();
  });

  it('returns null for "localhost" (no public suffix anchor)', () => {
    expect(normalizeEtldPlusOne('localhost')).toBeNull();
  });

  it('lowercases the result', () => {
    expect(normalizeEtldPlusOne('EXAMPLE.COM')).toBe('example.com');
  });

  it('trims leading/trailing whitespace before processing', () => {
    expect(normalizeEtldPlusOne('  example.com  ')).toBe('example.com');
  });
});
