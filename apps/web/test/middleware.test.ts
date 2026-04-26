import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

// SPEC §5.10 + amendment A8 — verbatim CSP string. Tests assert string
// equality. Amendment A8 adds `style-src 'self' 'unsafe-inline'` so
// Recharts inline-style attributes are not blocked (issue #133).
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'";

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

  // Amendment A8 (issue #133) — Recharts emits inline `style` attributes
  // for chart dimensions. `style-src` must include `'unsafe-inline'` or
  // chart SVGs render at 0px height. `script-src` MUST stay strict
  // (no `'unsafe-inline'`) because that is the XSS-relevant directive.
  describe('amendment A8 — style-src vs script-src laxity (issue #133)', () => {
    it("style-src contains 'unsafe-inline' (Recharts compatibility)", () => {
      const res = middleware(reqFor('/r/abc'));
      const csp = res.headers.get('content-security-policy') ?? '';
      const styleDirective = csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith('style-src'));
      expect(styleDirective, 'CSP must declare a style-src directive').toBeTruthy();
      expect(styleDirective).toContain("'unsafe-inline'");
    });

    it("script-src does NOT contain 'unsafe-inline' (XSS surface stays strict)", () => {
      const res = middleware(reqFor('/r/abc'));
      const csp = res.headers.get('content-security-policy') ?? '';
      const scriptDirective = csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith('script-src'));
      expect(scriptDirective, 'CSP must declare a script-src directive').toBeTruthy();
      expect(scriptDirective).not.toContain("'unsafe-inline'");
      expect(scriptDirective).not.toContain("'unsafe-eval'");
    });
  });
});
