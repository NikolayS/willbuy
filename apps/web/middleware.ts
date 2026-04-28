import { NextResponse, type NextRequest } from 'next/server';

// SPEC §5.10 + amendments A8 + A9. Drift in this directive set is
// guarded by apps/web/test/middleware.test.ts; do NOT reformat or
// rebuild the directive list from parts without updating that file.
//
// `script-src 'self' 'nonce-<value>' 'strict-dynamic'` (amendment A9,
// issue #135): Next.js 14 App Router emits inline `<script>` tags
// during SSR that drive client hydration (the
// `(self.__next_f = ...).push([1, "..."])` RSC flight payloads). The
// strict `script-src 'self'` we shipped in PR #13 silently blocked
// them, so the client never received the RSC tree and Recharts
// never mounted. The fix is the canonical Next.js 14 nonce pattern:
//   1. Generate a per-request nonce (16 random bytes, base64).
//   2. Forward it on the *request* via `x-nonce` so Next.js stamps
//      the same value on its own inline scripts (Next 14 reads this
//      header convention internally).
//   3. Add it to CSP `script-src` together with `'strict-dynamic'`
//      so the nonce'd bootstrap scripts can authorize their chunk
//      `<script src=".../_next/static/chunks/...">` loads via the
//      transitive-trust mechanism.
// `'self'` stays in the directive as a belt-and-suspenders fallback
// for browsers that ignore `'strict-dynamic'` (CSP3 mandates that
// `'self'` be ignored when `'strict-dynamic'` is present, but older
// engines fall back to `'self'` whitelisting).
//
// `style-src 'self' 'unsafe-inline'` (amendment A8, issue #133):
// Recharts' <ResponsiveContainer> emits inline `style` attributes
// for chart dimensions; the strict `style-src 'self'` collapsed
// charts to 0px height. Inline-JS injection paths are forbidden by
// the `react/no-danger` lint rule independent of CSP, so this
// loosening does not regress §5.10's XSS posture.
//
// `require-trusted-types-for 'script'` REMOVED (2026-04-27, amendment A13).
// Trusted Types enforcement blocked Next.js 14 App Router client hydration:
// React's flight-payload deserialization passes plain strings to innerHTML,
// which throws under Trusted Types. Symptoms reported by user on
// /dashboard/studies/new: range slider doesn't update displayed N, "Add
// second URL" link doesn't expand the form, "Start study" button does
// nothing — because React never hydrates the form. XSS posture remains
// strong via nonce + 'strict-dynamic' + object-src 'none' + base-uri 'self'
// and the application-level `react/no-danger` lint rule.

const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()';

// 16 random bytes -> 24-character base64; comfortably above the
// "sufficiently random" bar (CSP3 SHOULD be >= 128 bits of entropy).
function generateNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  // Build a binary string for btoa without spreading into
  // String.fromCharCode(...) (defensive against future-larger
  // buffers — at 16 bytes the spread would be fine, but the
  // explicit loop reads the same as the canonical Edge example).
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i] as number);
  return btoa(bin);
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

// Marketing routes (e.g. /) intentionally fall outside this matcher and
// therefore receive Next.js's default (relaxed) header set. SPEC §5.10
// scopes the strict CSP to /dashboard/* and /r/* — the routes that may
// render captured page text, LLM output, or cluster labels. Tightening
// the marketing surface to the same CSP would require self-hosting
// fonts/analytics with no benefit since no untrusted content lands there.
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/r/')) {
    const nonce = generateNonce();
    const csp = buildCsp(nonce);

    // Forward x-nonce on the *request* headers so the Next.js
    // RSC renderer reads it and stamps it on its own inline
    // bootstrap <script> tags. This is the documented Next 14
    // convention. See
    // https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-nonce', nonce);

    const res = NextResponse.next({
      request: { headers: requestHeaders },
    });

    res.headers.set('Content-Security-Policy', csp);
    res.headers.set('x-nonce', nonce);
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Referrer-Policy', 'no-referrer');
    res.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/r/:path*'],
};
