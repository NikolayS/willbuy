import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

// SPEC §5.10 + amendments A8 + A9 — CSP header. The script-src now
// carries a per-request nonce + 'strict-dynamic' (A9, issue #135) so
// Next.js 14 App Router inline bootstrap scripts can hydrate the
// client. The style-src laxity from A8 stays untouched. We extract
// the nonce dynamically per request and check directive shape.

const EXPECTED_PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()';

function reqFor(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${path}`));
}

function getCspDirective(csp: string, name: string): string | undefined {
  return csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);
}

function extractNonce(csp: string): string | null {
  const scriptDirective = getCspDirective(csp, 'script-src') ?? '';
  const m = scriptDirective.match(/'nonce-([A-Za-z0-9+/=_-]+)'/);
  return m && m[1] !== undefined ? m[1] : null;
}

describe('SPEC §5.10 — CSP middleware', () => {
  it('GET /dashboard/anything carries a CSP header with all required directives', () => {
    const res = middleware(reqFor('/dashboard/anything'));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(getCspDirective(csp!, 'default-src')).toBe("default-src 'self'");
    expect(getCspDirective(csp!, 'object-src')).toBe("object-src 'none'");
    expect(getCspDirective(csp!, 'base-uri')).toBe("base-uri 'self'");
    expect(getCspDirective(csp!, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(getCspDirective(csp!, 'form-action')).toBe("form-action 'self'");
    // Trusted Types directive removed in amendment A13 (2026-04-27):
    // it blocked Next.js 14 client-side hydration via innerHTML in the
    // RSC flight-payload deserialization. XSS protection remains strong
    // via the nonce + 'strict-dynamic' + object-src + base-uri set above.
    expect(csp).not.toContain("require-trusted-types-for");
  });

  it('GET /dashboard/* carries the additional security headers', () => {
    const res = middleware(reqFor('/dashboard/x'));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('permissions-policy')).toBe(EXPECTED_PERMISSIONS_POLICY);
  });

  it('GET /r/abc carries a CSP header', () => {
    const res = middleware(reqFor('/r/abc'));
    expect(res.headers.get('content-security-policy')).toBeTruthy();
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
  // chart SVGs render at 0px height.
  describe('amendment A8 — style-src laxity (issue #133)', () => {
    it("style-src contains 'unsafe-inline' (Recharts compatibility)", () => {
      const res = middleware(reqFor('/r/abc'));
      const csp = res.headers.get('content-security-policy') ?? '';
      const styleDirective = getCspDirective(csp, 'style-src');
      expect(styleDirective, 'CSP must declare a style-src directive').toBeTruthy();
      expect(styleDirective).toContain("'unsafe-inline'");
      expect(styleDirective).toContain("'self'");
    });
  });

  // Amendment A9 (issue #135) — Next.js 14 App Router emits inline
  // bootstrap <script> tags that drive client hydration (the
  // `self.__next_f.push(...)` payloads delivering the RSC flight tree).
  // CSP must permit them via a per-request nonce; `'unsafe-inline'`
  // remains FORBIDDEN in script-src per §5.10.
  describe('amendment A9 — script-src nonce + strict-dynamic (issue #135)', () => {
    it("script-src contains 'self', a 'nonce-<value>', and 'strict-dynamic'", () => {
      const res = middleware(reqFor('/r/abc'));
      const csp = res.headers.get('content-security-policy') ?? '';
      const scriptDirective = getCspDirective(csp, 'script-src');
      expect(scriptDirective, 'CSP must declare a script-src directive').toBeTruthy();
      expect(scriptDirective).toContain("'self'");
      expect(scriptDirective).toMatch(/'nonce-[A-Za-z0-9+/=_-]+'/);
      expect(scriptDirective).toContain("'strict-dynamic'");
    });

    it("script-src does NOT contain 'unsafe-inline' or 'unsafe-eval' (XSS surface stays strict)", () => {
      const res = middleware(reqFor('/r/abc'));
      const csp = res.headers.get('content-security-policy') ?? '';
      const scriptDirective = getCspDirective(csp, 'script-src') ?? '';
      expect(scriptDirective).not.toContain("'unsafe-inline'");
      expect(scriptDirective).not.toContain("'unsafe-eval'");
    });

    it('middleware exposes a same-request nonce on x-nonce response header', () => {
      const res = middleware(reqFor('/r/abc'));
      // The nonce is mirrored on the response headers so downstream
      // tests + (theoretically) edge consumers can read it without a
      // fresh randomUUID call. Same nonce must appear in the CSP
      // script-src directive.
      const responseNonce = res.headers.get('x-nonce');
      expect(responseNonce, 'middleware must expose x-nonce on response').toBeTruthy();
      expect(responseNonce!.length, 'nonce must be sufficiently random').toBeGreaterThanOrEqual(16);
      const csp = res.headers.get('content-security-policy') ?? '';
      const cspNonce = extractNonce(csp);
      expect(cspNonce, 'CSP script-src must contain the same nonce as x-nonce').toBe(
        responseNonce
      );
    });

    it('middleware sets x-nonce on the forwarded request headers (Next.js auto-nonce convention)', () => {
      // Next.js 14 reads `x-nonce` from the *request* headers it
      // forwards to the route handler so it can stamp the same value
      // on its own inline RSC bootstrap scripts. We test the contract
      // by inspecting the response's `x-middleware-request-x-nonce`
      // shadow header that Next.js mirrors when middleware mutates
      // request headers via `NextResponse.next({ request: { headers } })`.
      const res = middleware(reqFor('/r/abc'));
      const forwardedNonce = res.headers.get('x-middleware-request-x-nonce');
      expect(
        forwardedNonce,
        'middleware must forward x-nonce on the request via NextResponse.next({ request })'
      ).toBeTruthy();
      const responseNonce = res.headers.get('x-nonce');
      expect(forwardedNonce).toBe(responseNonce);
    });

    it('successive requests get distinct nonces (no module-scope memoization)', () => {
      const a = middleware(reqFor('/r/abc'));
      const b = middleware(reqFor('/r/abc'));
      const nonceA = extractNonce(a.headers.get('content-security-policy') ?? '');
      const nonceB = extractNonce(b.headers.get('content-security-policy') ?? '');
      expect(nonceA).toBeTruthy();
      expect(nonceB).toBeTruthy();
      expect(nonceA).not.toBe(nonceB);
    });

    it('nonce uses URL-safe base64 / hex characters only', () => {
      const res = middleware(reqFor('/r/abc'));
      const nonce = res.headers.get('x-nonce') ?? '';
      // Base64 (with `=` padding allowed), base64url (`-`, `_`), or hex.
      expect(nonce).toMatch(/^[A-Za-z0-9+/=_-]+$/);
    });
  });
});
