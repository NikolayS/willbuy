/**
 * session-cookie-helpers.test.ts — unit tests for the pure cookie-string
 * helpers exported from auth/session.ts.
 *
 * Spec refs:
 *   §5.10 — HttpOnly + SameSite=Lax + Secure in prod + __Host- prefix
 *   §2 #20 — no cookie leak on 401 paths
 *
 * Functions under test (all pure, no DB, no Fastify):
 *   parseCookie       — extracts a named cookie from a Cookie header string
 *   buildSetCookieHeader — builds the full Set-Cookie header value
 *   buildClearCookieHeader — builds a Max-Age=0 cookie-clearing header
 */

import { describe, expect, it } from 'vitest';
import {
  parseCookie,
  buildSetCookieHeader,
  buildClearCookieHeader,
  COOKIE_NAME_DEV,
  COOKIE_NAME_PROD,
} from '../src/auth/session.js';

// ── parseCookie ───────────────────────────────────────────────────────────────

describe('parseCookie()', () => {
  it('extracts the value of a named cookie from a single-cookie header', () => {
    expect(parseCookie('wb_session=abc123', 'wb_session')).toBe('abc123');
  });

  it('extracts the named cookie when multiple cookies are present', () => {
    expect(
      parseCookie('foo=bar; wb_session=tok123; baz=qux', 'wb_session'),
    ).toBe('tok123');
  });

  it('returns undefined when the named cookie is absent', () => {
    expect(parseCookie('foo=bar; baz=qux', 'wb_session')).toBeUndefined();
  });

  it('returns undefined for an empty header string', () => {
    expect(parseCookie('', 'wb_session')).toBeUndefined();
  });

  it('handles values containing "=" (e.g. base64url with padding)', () => {
    // base64 tokens may end with "=" — parseCookie must not split on them.
    const token = 'eyJhbGciOiJIUzI1NiJ9.payload==';
    expect(
      parseCookie(`wb_session=${token}`, 'wb_session'),
    ).toBe(token);
  });

  it('is case-sensitive for cookie names', () => {
    expect(parseCookie('WB_SESSION=abc', 'wb_session')).toBeUndefined();
  });
});

// ── buildSetCookieHeader ──────────────────────────────────────────────────────

describe('buildSetCookieHeader() — spec §5.10', () => {
  it('dev: uses "wb_session" name without Secure flag', () => {
    const hdr = buildSetCookieHeader('tok', 'development', 3600);
    expect(hdr).toMatch(/^wb_session=tok;/);
    expect(hdr).toContain('HttpOnly');
    expect(hdr).toContain('SameSite=Lax');
    expect(hdr).toContain('Path=/');
    expect(hdr).toContain('Max-Age=3600');
    expect(hdr).not.toContain('Secure');
    expect(hdr).not.toContain('__Host-');
  });

  it('production: uses "__Host-wb_session" name with Secure flag', () => {
    const hdr = buildSetCookieHeader('tok', 'production', 604800);
    expect(hdr).toMatch(/^__Host-wb_session=tok;/);
    expect(hdr).toContain('HttpOnly');
    expect(hdr).toContain('Secure');
    expect(hdr).toContain('SameSite=Lax');
    expect(hdr).toContain('Path=/');
    expect(hdr).toContain('Max-Age=604800');
  });

  it('test env: uses dev cookie name (same as development)', () => {
    const hdr = buildSetCookieHeader('tok', 'test', 60);
    expect(hdr).toMatch(new RegExp(`^${COOKIE_NAME_DEV}=tok;`));
    expect(hdr).not.toContain('Secure');
  });

  it('includes the exact cookie value verbatim', () => {
    const value = 'eyJhbGciOiJIUzI1NiJ9.abc.xyz';
    const hdr = buildSetCookieHeader(value, 'development', 60);
    expect(hdr).toContain(`wb_session=${value};`);
  });
});

// ── buildClearCookieHeader ────────────────────────────────────────────────────

describe('buildClearCookieHeader() — spec §2 #20', () => {
  it('dev: builds a Max-Age=0 cookie without Secure', () => {
    const hdr = buildClearCookieHeader('development');
    expect(hdr).toMatch(/^wb_session=;/);
    expect(hdr).toContain('Max-Age=0');
    expect(hdr).toContain('HttpOnly');
    expect(hdr).not.toContain('Secure');
  });

  it('production: builds a Max-Age=0 cookie with Secure and __Host- prefix', () => {
    const hdr = buildClearCookieHeader('production');
    expect(hdr).toMatch(/^__Host-wb_session=;/);
    expect(hdr).toContain('Max-Age=0');
    expect(hdr).toContain('HttpOnly');
    expect(hdr).toContain('Secure');
  });

  it('cookie name constants are consistent with buildClearCookieHeader output', () => {
    expect(buildClearCookieHeader('development')).toMatch(new RegExp(`^${COOKIE_NAME_DEV}=`));
    expect(buildClearCookieHeader('production')).toMatch(new RegExp(`^${COOKIE_NAME_PROD.replace(/-/g, '\\-')}=`));
  });
});
