/**
 * reports-crypto.test.ts — unit tests for the crypto helpers in routes/reports.ts.
 *
 * These functions are the HMAC-signed share-token cookie layer that protects
 * private report access (spec §2 #20, §5.18 export+share). They are tested
 * indirectly by the Docker-gated reports.cookie.test.ts; this file exercises
 * them directly without any DB or network.
 *
 * Tests:
 *   buildCookieValue + verifyCookieValue
 *     1. Round-trip: build then verify returns correct slug/expiresAt/accountId.
 *     2. Tampered signature → null.
 *     3. Wrong slug → null.
 *     4. Expired cookie → still parses (expiry is caller-checked, not in verify).
 *     5. Missing dot → null.
 *   parseCookie
 *     6. Single cookie → value.
 *     7. Multi-cookie header → correct value.
 *     8. Missing name → undefined.
 *     9. Empty header → undefined.
 *   tokenMatchesHash
 *    10. Same token → true.
 *    11. Different token → false.
 *   MAX_COOKIE_SECONDS spec-pin
 *    12. 7200 (2 hours per spec §2 #20).
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/routes/reports.js';

const { buildCookieValue, verifyCookieValue, parseCookie, tokenMatchesHash, MAX_COOKIE_SECONDS } =
  __test__;

const HMAC_KEY = 'test-hmac-key-that-is-at-least-32-chars-long';
const SLUG = 'test-slug-abc123';
const ACCOUNT_ID = '42';

describe('buildCookieValue + verifyCookieValue', () => {
  it('round-trips: verify returns the same slug, expiresAt, accountId', () => {
    const expiresAt = new Date('2099-01-01T00:00:00.000Z');
    const cookie = buildCookieValue(SLUG, expiresAt, ACCOUNT_ID, HMAC_KEY);
    const result = verifyCookieValue(cookie, SLUG, HMAC_KEY);
    expect(result).not.toBeNull();
    expect(result!.slug).toBe(SLUG);
    expect(result!.accountId).toBe(ACCOUNT_ID);
    expect(result!.expiresAt.toISOString()).toBe(expiresAt.toISOString());
  });

  it('returns null when the signature is tampered', () => {
    const expiresAt = new Date('2099-01-01T00:00:00.000Z');
    const cookie = buildCookieValue(SLUG, expiresAt, ACCOUNT_ID, HMAC_KEY);
    const tampered = cookie.slice(0, -4) + 'XXXX';
    expect(verifyCookieValue(tampered, SLUG, HMAC_KEY)).toBeNull();
  });

  it('returns null when the expected slug does not match the cookie slug', () => {
    const expiresAt = new Date('2099-01-01T00:00:00.000Z');
    const cookie = buildCookieValue(SLUG, expiresAt, ACCOUNT_ID, HMAC_KEY);
    expect(verifyCookieValue(cookie, 'different-slug', HMAC_KEY)).toBeNull();
  });

  it('returns null for a cookie without a dot separator', () => {
    expect(verifyCookieValue('nodot', SLUG, HMAC_KEY)).toBeNull();
  });

  it('parses an expired cookie (caller is responsible for expiry check)', () => {
    const expiresAt = new Date('2000-01-01T00:00:00.000Z');
    const cookie = buildCookieValue(SLUG, expiresAt, ACCOUNT_ID, HMAC_KEY);
    const result = verifyCookieValue(cookie, SLUG, HMAC_KEY);
    expect(result).not.toBeNull();
    expect(result!.expiresAt < new Date()).toBe(true);
  });
});

describe('parseCookie', () => {
  it('returns the value for a single-cookie header', () => {
    expect(parseCookie('name=value', 'name')).toBe('value');
  });

  it('extracts the correct value from a multi-cookie header', () => {
    expect(parseCookie('a=1; b=2; name=target; c=3', 'name')).toBe('target');
  });

  it('returns undefined when the named cookie is absent', () => {
    expect(parseCookie('a=1; b=2', 'name')).toBeUndefined();
  });

  it('returns undefined for an undefined header', () => {
    expect(parseCookie(undefined, 'name')).toBeUndefined();
  });
});

describe('tokenMatchesHash', () => {
  it('returns true when the token matches its own SHA-256 hex hash', () => {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    const token = 'abc123-test-token';
    const hash = createHash('sha256').update(token).digest('hex');
    expect(tokenMatchesHash(token, hash)).toBe(true);
  });

  it('returns false for a different token', () => {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    const hash = createHash('sha256').update('right-token').digest('hex');
    expect(tokenMatchesHash('wrong-token', hash)).toBe(false);
  });
});

describe('MAX_COOKIE_SECONDS spec-pin (spec §2 #20)', () => {
  it('is 7200 (2 hours)', () => {
    expect(MAX_COOKIE_SECONDS).toBe(7200);
  });
});
