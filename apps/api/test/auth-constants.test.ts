/**
 * auth-constants.test.ts — spec-pin tests for auth route constants.
 *
 * SESSION_7_DAYS_SECONDS (604800): determines how long a session cookie
 * is valid. A silent change shortens or extends session lifetime without
 * the spec mandating it.
 *
 * MAGIC_LINK_EXPIRY_MINUTES (30): determines how long a sign-in link
 * works. The email template explicitly says "30 minutes" — divergence
 * would be a lie to the user.
 *
 * safeRedirect: open-redirect prevention used in two request handlers
 * (magic-link POST and GET /api/auth/verify). Previously only covered
 * by Docker-gated AC10/AC11 integration tests.
 *
 * Tests:
 *   1. SESSION_7_DAYS_SECONDS is 604800 (7 × 24 × 60 × 60).
 *   2. MAGIC_LINK_EXPIRY_MINUTES is 30.
 *   3. safeRedirect(undefined) → '/dashboard'.
 *   4. safeRedirect('/valid/path') → '/valid/path'.
 *   5. safeRedirect('//evil.com') → '/dashboard'.
 *   6. safeRedirect('https://evil.com') → '/dashboard'.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/routes/auth.js';

const { SESSION_7_DAYS_SECONDS, MAGIC_LINK_EXPIRY_MINUTES, safeRedirect } = __test__;

describe('auth session constants spec-pin', () => {
  it('SESSION_7_DAYS_SECONDS is 604800 (7 days)', () => {
    expect(SESSION_7_DAYS_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(SESSION_7_DAYS_SECONDS).toBe(604800);
  });

  it('MAGIC_LINK_EXPIRY_MINUTES is 30 (matches email copy)', () => {
    expect(MAGIC_LINK_EXPIRY_MINUTES).toBe(30);
  });
});

describe('safeRedirect (open-redirect prevention)', () => {
  it('returns /dashboard for undefined input', () => {
    expect(safeRedirect(undefined)).toBe('/dashboard');
  });

  it('passes through a valid relative path', () => {
    expect(safeRedirect('/dashboard/studies')).toBe('/dashboard/studies');
  });

  it('blocks protocol-relative URLs', () => {
    expect(safeRedirect('//evil.com')).toBe('/dashboard');
  });

  it('blocks absolute URLs', () => {
    expect(safeRedirect('https://evil.com')).toBe('/dashboard');
  });
});
