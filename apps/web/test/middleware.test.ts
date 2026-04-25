import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

// SPEC §5.10 — verbatim CSP string. Tests assert string equality.
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'";

const EXPECTED_PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()';

function reqFor(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${path}`));
}

describe('SPEC §5.10 — CSP middleware', () => {
  it('GET /dashboard/anything carries the exact CSP header (string equality)', () => {
    const res = middleware(reqFor('/dashboard/anything'));
    expect(res.headers.get('content-security-policy')).toBe(EXPECTED_CSP);
  });

  it('GET /dashboard/* carries the additional security headers', () => {
    const res = middleware(reqFor('/dashboard/x'));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('permissions-policy')).toBe(EXPECTED_PERMISSIONS_POLICY);
  });

  it('GET /r/abc carries the exact CSP header (string equality)', () => {
    const res = middleware(reqFor('/r/abc'));
    expect(res.headers.get('content-security-policy')).toBe(EXPECTED_CSP);
  });

  it('GET /r/* carries the additional security headers', () => {
    const res = middleware(reqFor('/r/abc'));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('permissions-policy')).toBe(EXPECTED_PERMISSIONS_POLICY);
  });

  it('marketing GET / does NOT carry the strict CSP (relaxed per spec scope)', () => {
    const res = middleware(reqFor('/'));
    // Marketing pages are out of the §5.10 strict-CSP scope (which is
    // /dashboard/* and /r/*). The middleware matcher must not run on them.
    // We model that here by asserting the middleware function, when called
    // on /, returns a response without the strict CSP.
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});
