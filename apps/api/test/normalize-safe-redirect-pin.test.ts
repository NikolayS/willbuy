/**
 * normalize-safe-redirect-pin.test.ts — unit tests for two pure helper
 * functions with security implications (no DB required).
 *
 * normalizeEtldPlusOne (domains.ts):
 *   Extracts the eTLD+1 from user-supplied domain strings. Must reject
 *   localhost, bare labels without a TLD, empty strings, and strings with
 *   whitespace. Silently lowercases and trims (spec §2 #1).
 *
 * safeRedirect (auth.ts):
 *   Validates a redirect path: must start with '/', must NOT start with '//',
 *   must NOT contain '://'. Falls back to '/dashboard' on any violation
 *   (spec §2 #26 open-redirect guard).
 */

import { describe, it, expect } from 'vitest';
import { __test__ as authTest } from '../src/routes/auth.js';
import { __test__ as domainsTest } from '../src/routes/domains.js';

const { safeRedirect } = authTest;
const { normalizeEtldPlusOne } = domainsTest;

describe('normalizeEtldPlusOne (spec §2 #1 domain normalization)', () => {
  it('returns eTLD+1 for a bare hostname', () => {
    expect(normalizeEtldPlusOne('example.com')).toBe('example.com');
  });

  it('strips subdomain, keeps eTLD+1', () => {
    expect(normalizeEtldPlusOne('sub.example.com')).toBe('example.com');
  });

  it('lowercases the result', () => {
    expect(normalizeEtldPlusOne('EXAMPLE.COM')).toBe('example.com');
  });

  it('trims leading/trailing whitespace before processing', () => {
    expect(normalizeEtldPlusOne('  example.com  ')).toBe('example.com');
  });

  it('returns null for an empty string', () => {
    expect(normalizeEtldPlusOne('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(normalizeEtldPlusOne('   ')).toBeNull();
  });

  it('returns null for a string containing internal whitespace', () => {
    expect(normalizeEtldPlusOne('exa mple.com')).toBeNull();
  });

  it('returns null for localhost (no dot = not a public-suffix domain)', () => {
    expect(normalizeEtldPlusOne('localhost')).toBeNull();
  });

  it('returns null for a bare label without a TLD', () => {
    expect(normalizeEtldPlusOne('notatld')).toBeNull();
  });

  it('handles a URL by extracting its eTLD+1', () => {
    // tldts.getDomain also handles URLs
    const result = normalizeEtldPlusOne('https://sub.example.com/path');
    expect(result).toBe('example.com');
  });
});

describe('safeRedirect (spec §2 #26 open-redirect guard)', () => {
  it('returns the path unchanged when it starts with / and is not protocol-relative', () => {
    expect(safeRedirect('/dashboard/studies')).toBe('/dashboard/studies');
  });

  it('returns /dashboard for undefined input', () => {
    expect(safeRedirect(undefined)).toBe('/dashboard');
  });

  it('returns /dashboard for an absolute URL (contains ://)', () => {
    expect(safeRedirect('https://evil.com')).toBe('/dashboard');
  });

  it('returns /dashboard for a protocol-relative URL (starts with //)', () => {
    expect(safeRedirect('//evil.com')).toBe('/dashboard');
  });

  it('returns /dashboard for a path containing ://', () => {
    expect(safeRedirect('/redirect?to=http://evil.com')).toBe('/dashboard');
  });

  it('returns /dashboard for an empty string', () => {
    expect(safeRedirect('')).toBe('/dashboard');
  });

  it('returns / (root) when that is the redirect path', () => {
    expect(safeRedirect('/')).toBe('/');
  });
});
