/**
 * cookie-name-spec-pin.test.ts — spec-pins for COOKIE_NAME_PROD and
 * COOKIE_NAME_DEV in apps/api/src/auth/session.ts (spec §5.10).
 *
 * COOKIE_NAME_PROD = '__Host-wb_session':
 *   The __Host- prefix mandates Secure + Path=/ + no Domain= per RFC 6265bis.
 *   Renaming it (e.g. dropping the __Host- prefix) silently removes the Host
 *   binding and allows the session cookie to be sent on non-root paths or
 *   across subdomains. Spec §5.10 explicitly requires the __Host- prefix in
 *   production.
 *
 * COOKIE_NAME_DEV = 'wb_session':
 *   The dev/test name without the Host prefix. Using the production name in dev
 *   would require HTTPS even in local testing. Both names must stay in sync
 *   with the cookie parser in the web app and any monitoring rules.
 *
 * cookieName(env) routing:
 *   - 'production' → COOKIE_NAME_PROD
 *   - any other value → COOKIE_NAME_DEV
 */

import { describe, expect, it } from 'vitest';
import {
  COOKIE_NAME_PROD,
  COOKIE_NAME_DEV,
  cookieName,
} from '../src/auth/session.js';

describe('COOKIE_NAME_PROD spec-pin (spec §5.10 — __Host- prefix)', () => {
  it('is "__Host-wb_session"', () => {
    expect(COOKIE_NAME_PROD).toBe('__Host-wb_session');
  });

  it('starts with "__Host-" prefix (RFC 6265bis Host prefix requirement)', () => {
    expect(COOKIE_NAME_PROD.startsWith('__Host-')).toBe(true);
  });

  it('ends with "wb_session" (cookie identity across prod/dev)', () => {
    expect(COOKIE_NAME_PROD.endsWith('wb_session')).toBe(true);
  });
});

describe('COOKIE_NAME_DEV spec-pin', () => {
  it('is "wb_session"', () => {
    expect(COOKIE_NAME_DEV).toBe('wb_session');
  });

  it('does not have __Host- prefix (allows HTTP in dev)', () => {
    expect(COOKIE_NAME_DEV.startsWith('__Host-')).toBe(false);
  });
});

describe('cookieName(env) routing spec-pin', () => {
  it('returns COOKIE_NAME_PROD for "production"', () => {
    expect(cookieName('production')).toBe(COOKIE_NAME_PROD);
  });

  it('returns COOKIE_NAME_DEV for "development"', () => {
    expect(cookieName('development')).toBe(COOKIE_NAME_DEV);
  });

  it('returns COOKIE_NAME_DEV for "test"', () => {
    expect(cookieName('test')).toBe(COOKIE_NAME_DEV);
  });

  it('returns COOKIE_NAME_DEV for any non-production string', () => {
    expect(cookieName('staging')).toBe(COOKIE_NAME_DEV);
    expect(cookieName('')).toBe(COOKIE_NAME_DEV);
  });
});
