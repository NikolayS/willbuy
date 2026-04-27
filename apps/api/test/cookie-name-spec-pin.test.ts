/**
 * cookie-name-spec-pin.test.ts — spec-pins for session cookie names (spec §5.10).
 *
 * COOKIE_NAME_PROD = '__Host-wb_session': the __Host- prefix mandates
 *   Secure + Path=/ + no Domain= attribute per RFC 6265bis §4.1.3.
 *   Removing it silently downgrades session cookie security in production.
 *
 * COOKIE_NAME_DEV = 'wb_session': the unprefixed name is correct for
 *   HTTP localhost dev (where Secure cannot apply). The difference between
 *   these two values is intentional — they must not accidentally match.
 *
 * cookieName(): maps 'production' → COOKIE_NAME_PROD, else → COOKIE_NAME_DEV.
 */

import { describe, expect, it } from 'vitest';

import { COOKIE_NAME_PROD, COOKIE_NAME_DEV, cookieName } from '../src/auth/session.js';

describe('session cookie name spec-pins (spec §5.10)', () => {
  it('COOKIE_NAME_PROD is "__Host-wb_session"', () => {
    expect(COOKIE_NAME_PROD).toBe('__Host-wb_session');
  });

  it('COOKIE_NAME_DEV is "wb_session"', () => {
    expect(COOKIE_NAME_DEV).toBe('wb_session');
  });

  it('production and dev names are distinct', () => {
    expect(COOKIE_NAME_PROD).not.toBe(COOKIE_NAME_DEV);
  });

  it('cookieName("production") returns COOKIE_NAME_PROD', () => {
    expect(cookieName('production')).toBe(COOKIE_NAME_PROD);
  });

  it('cookieName("development") returns COOKIE_NAME_DEV', () => {
    expect(cookieName('development')).toBe(COOKIE_NAME_DEV);
  });

  it('cookieName("test") returns COOKIE_NAME_DEV', () => {
    expect(cookieName('test')).toBe(COOKIE_NAME_DEV);
  });
});
