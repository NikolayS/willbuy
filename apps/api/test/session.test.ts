/**
 * session.test.ts — unit tests for encodeSession / decodeSession / cookieName
 * (apps/api/src/auth/session.ts).
 *
 * These functions are used in nearly every integration test via test helpers
 * but are never tested in isolation. The critical invariant is that a tampered
 * HMAC or expired cookie returns null from decodeSession, not a payload.
 */

import { describe, expect, it } from 'vitest';
import {
  encodeSession,
  decodeSession,
  cookieName,
  COOKIE_NAME_PROD,
  COOKIE_NAME_DEV,
} from '../src/auth/session.js';

const HMAC_KEY = 'test-session-hmac-key-at-least-32-characters-long';

function futureIso(days = 7): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function pastIso(days = 1): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('cookieName()', () => {
  it('returns __Host-wb_session in production', () => {
    expect(cookieName('production')).toBe(COOKIE_NAME_PROD);
  });

  it('returns wb_session in test/dev', () => {
    expect(cookieName('test')).toBe(COOKIE_NAME_DEV);
    expect(cookieName('development')).toBe(COOKIE_NAME_DEV);
  });
});

describe('encodeSession() / decodeSession()', () => {
  it('round-trips a valid payload', () => {
    const payload = {
      account_id: '42',
      owner_email: 'test@example.com',
      expires_at: futureIso(),
    };
    const token = encodeSession(payload, HMAC_KEY);
    const decoded = decodeSession(token, HMAC_KEY);
    expect(decoded).not.toBeNull();
    expect(decoded?.account_id).toBe('42');
    expect(decoded?.owner_email).toBe('test@example.com');
  });

  it('returns null for an expired session', () => {
    const payload = {
      account_id: '1',
      owner_email: 'x@example.com',
      expires_at: pastIso(),
    };
    const token = encodeSession(payload, HMAC_KEY);
    expect(decodeSession(token, HMAC_KEY)).toBeNull();
  });

  it('returns null when the HMAC is tampered', () => {
    const payload = {
      account_id: '1',
      owner_email: 'x@example.com',
      expires_at: futureIso(),
    };
    const token = encodeSession(payload, HMAC_KEY);
    // Flip the last character of the MAC segment.
    const parts = token.split('.');
    parts[parts.length - 1] = parts[parts.length - 1]!.slice(0, -1) + 'X';
    expect(decodeSession(parts.join('.'), HMAC_KEY)).toBeNull();
  });

  it('returns null when signed with a different key', () => {
    const payload = {
      account_id: '1',
      owner_email: 'x@example.com',
      expires_at: futureIso(),
    };
    const token = encodeSession(payload, HMAC_KEY);
    expect(decodeSession(token, 'a-completely-different-hmac-key-of-at-least-32-chars')).toBeNull();
  });

  it('returns null for a string with no dot separator', () => {
    expect(decodeSession('no-dot-in-here', HMAC_KEY)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeSession('', HMAC_KEY)).toBeNull();
  });

  it('returns null when the payload is not valid JSON', () => {
    // Manually craft a token with a non-JSON base64 payload.
    const badPayload = Buffer.from('not-json').toString('base64url');
    const mac = Buffer.from('aaaa').toString('base64url');
    expect(decodeSession(`${badPayload}.${mac}`, HMAC_KEY)).toBeNull();
  });

  it('produces distinct tokens for distinct keys', () => {
    const payload = {
      account_id: '1',
      owner_email: 'x@example.com',
      expires_at: futureIso(),
    };
    const t1 = encodeSession(payload, HMAC_KEY);
    const t2 = encodeSession(payload, 'different-key-exactly-32-chars-xxxx');
    expect(t1).not.toBe(t2);
  });
});
