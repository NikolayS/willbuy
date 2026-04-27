/**
 * safe-redirect.test.ts — unit tests for the open-redirect prevention helper
 * in routes/auth.ts (spec §4.1, AC11 from auth.test.ts).
 *
 * safeRedirect() is the security guard on the `redirect` query param passed
 * through the magic-link verification flow. A bug here enables open-redirect
 * attacks. These pure unit tests exercise all 6 branches without DB or network.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/routes/auth.js';

const { safeRedirect } = __test__;

describe('safeRedirect (open-redirect prevention, AC11)', () => {
  it('returns /dashboard when input is undefined', () => {
    expect(safeRedirect(undefined)).toBe('/dashboard');
  });

  it('returns /dashboard when input is empty string', () => {
    expect(safeRedirect('')).toBe('/dashboard');
  });

  it('returns the path unchanged for a valid relative path', () => {
    expect(safeRedirect('/dashboard/studies')).toBe('/dashboard/studies');
  });

  it('returns the path unchanged for the root path', () => {
    expect(safeRedirect('/')).toBe('/');
  });

  it('blocks protocol-relative URLs (//evil.com)', () => {
    expect(safeRedirect('//evil.com/phish')).toBe('/dashboard');
  });

  it('blocks absolute URLs with https://', () => {
    expect(safeRedirect('https://evil.com/steal')).toBe('/dashboard');
  });

  it('blocks strings containing :// not at the start', () => {
    expect(safeRedirect('/foo://bar')).toBe('/dashboard');
  });
});
