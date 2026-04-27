/**
 * encode-decode-session-pin.test.ts — correctness tests for
 * encodeSession() and decodeSession() (spec §5.10).
 *
 * These functions are used as a test helper in the Docker-gated integration
 * tests but have no dedicated unit test for their own contract. This file
 * pins:
 *  - encode→decode round-trip returns the original payload
 *  - tampered MAC returns null
 *  - expired session returns null
 *  - malformed cookie (no dot) returns null
 *  - wrong HMAC key returns null
 */

import { describe, it, expect } from 'vitest';
import { encodeSession, decodeSession } from '../src/auth/session.js';

const HMAC_KEY = 'test-hmac-key-at-least-32-characters-long';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
const PAST = new Date(Date.now() - 1000).toISOString(); // 1 second ago

const PAYLOAD = {
  account_id: '42',
  owner_email: 'test@example.com',
  expires_at: FUTURE,
};

describe('encodeSession() + decodeSession() round-trip (spec §5.10)', () => {
  it('decode(encode(payload)) returns the original payload', () => {
    const cookie = encodeSession(PAYLOAD, HMAC_KEY);
    const decoded = decodeSession(cookie, HMAC_KEY);
    expect(decoded).not.toBeNull();
    expect(decoded!.account_id).toBe(PAYLOAD.account_id);
    expect(decoded!.owner_email).toBe(PAYLOAD.owner_email);
    expect(decoded!.expires_at).toBe(PAYLOAD.expires_at);
  });

  it('encoded value contains a dot (base64url.mac format)', () => {
    const cookie = encodeSession(PAYLOAD, HMAC_KEY);
    expect(cookie).toContain('.');
  });
});

describe('decodeSession() — invalid inputs', () => {
  it('returns null for a tampered MAC', () => {
    const cookie = encodeSession(PAYLOAD, HMAC_KEY);
    const tampered = cookie.slice(0, -4) + 'XXXX';
    expect(decodeSession(tampered, HMAC_KEY)).toBeNull();
  });

  it('returns null for a cookie with no dot', () => {
    expect(decodeSession('nodothere', HMAC_KEY)).toBeNull();
  });

  it('returns null when the HMAC key differs', () => {
    const cookie = encodeSession(PAYLOAD, HMAC_KEY);
    expect(decodeSession(cookie, 'wrong-hmac-key-at-least-32-characters-l')).toBeNull();
  });

  it('returns null for an expired session', () => {
    const expired = encodeSession({ ...PAYLOAD, expires_at: PAST }, HMAC_KEY);
    expect(decodeSession(expired, HMAC_KEY)).toBeNull();
  });

  it('returns null for a completely invalid string', () => {
    expect(decodeSession('not-valid-at-all.MAC', HMAC_KEY)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeSession('', HMAC_KEY)).toBeNull();
  });
});
