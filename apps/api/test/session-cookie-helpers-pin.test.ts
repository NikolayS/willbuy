/**
 * session-cookie-helpers-pin.test.ts — correctness tests for session
 * cookie builder functions (spec §5.10).
 *
 * buildSetCookieHeader() and buildClearCookieHeader() are security-critical:
 * wrong flags (missing HttpOnly, missing Secure in prod, wrong SameSite)
 * would expose session cookies to XSS or cross-site requests. parseCookie()
 * is used in the report route for cookie extraction.
 *
 * These functions are exported from auth/session.ts but have no direct
 * unit tests (only indirectly tested through Docker-gated integration tests).
 *
 * Spec refs:
 *   §5.10 — wb_session cookie: HttpOnly, Secure (prod), SameSite=Lax, Path=/.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSetCookieHeader,
  buildClearCookieHeader,
  parseCookie,
  cookieName,
} from '../src/auth/session.js';

describe('buildSetCookieHeader() — spec §5.10 cookie flags', () => {
  it('includes HttpOnly in all environments', () => {
    const header = buildSetCookieHeader('val', 'development', 604800);
    expect(header).toContain('HttpOnly');
  });

  it('includes SameSite=Lax in all environments', () => {
    const header = buildSetCookieHeader('val', 'production', 604800);
    expect(header).toContain('SameSite=Lax');
  });

  it('includes Path=/ in all environments', () => {
    const header = buildSetCookieHeader('val', 'development', 604800);
    expect(header).toContain('Path=/');
  });

  it('includes Secure flag in production', () => {
    const header = buildSetCookieHeader('val', 'production', 604800);
    expect(header).toContain('; Secure');
  });

  it('does NOT include Secure flag in development', () => {
    const header = buildSetCookieHeader('val', 'development', 604800);
    expect(header).not.toContain('Secure');
  });

  it('includes Max-Age with the provided value', () => {
    const header = buildSetCookieHeader('val', 'development', 604800);
    expect(header).toContain('Max-Age=604800');
  });

  it('uses the correct cookie name for production (__Host- prefix)', () => {
    const header = buildSetCookieHeader('val', 'production', 604800);
    expect(header.startsWith(`${cookieName('production')}=val`)).toBe(true);
  });

  it('uses the correct cookie name for development (no __Host- prefix)', () => {
    const header = buildSetCookieHeader('val', 'development', 604800);
    expect(header.startsWith(`${cookieName('development')}=val`)).toBe(true);
  });
});

describe('buildClearCookieHeader() — cookie clearing (spec §5.10)', () => {
  it('sets Max-Age=0 to expire the cookie immediately', () => {
    expect(buildClearCookieHeader('development')).toContain('Max-Age=0');
  });

  it('sets value to empty string', () => {
    const header = buildClearCookieHeader('development');
    expect(header).toContain(`${cookieName('development')}=;`);
  });

  it('includes HttpOnly and SameSite=Lax', () => {
    const header = buildClearCookieHeader('production');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
  });

  it('includes Secure in production', () => {
    expect(buildClearCookieHeader('production')).toContain('; Secure');
  });

  it('does NOT include Secure in development', () => {
    expect(buildClearCookieHeader('development')).not.toContain('Secure');
  });
});

describe('parseCookie() — cookie header extraction', () => {
  it('extracts a named cookie from a simple header', () => {
    expect(parseCookie('session=abc123', 'session')).toBe('abc123');
  });

  it('extracts the correct cookie when multiple are present', () => {
    expect(parseCookie('foo=1; session=abc; bar=2', 'session')).toBe('abc');
  });

  it('returns undefined when the cookie is not present', () => {
    expect(parseCookie('foo=1; bar=2', 'session')).toBeUndefined();
  });

  it('handles cookie values containing = characters', () => {
    // e.g. base64url-encoded values may contain =
    expect(parseCookie('session=abc=def==', 'session')).toBe('abc=def==');
  });
});
