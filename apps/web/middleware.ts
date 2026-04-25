import { NextResponse, type NextRequest } from 'next/server';

// SPEC §5.10 — verbatim. The string compare in apps/web/test/middleware.test.ts
// guards against drift; do NOT reformat or rebuild this from parts.
const CSP =
  "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'";

const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()';

// Marketing routes (e.g. /) intentionally fall outside this matcher and
// therefore receive Next.js's default (relaxed) header set. SPEC §5.10
// scopes the strict CSP to /dashboard/* and /r/* — the routes that may
// render captured page text, LLM output, or cluster labels. Tightening
// the marketing surface to the same CSP would require self-hosting
// fonts/analytics with no benefit since no untrusted content lands there.
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const res = NextResponse.next();

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/r/')) {
    res.headers.set('Content-Security-Policy', CSP);
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Referrer-Policy', 'no-referrer');
    res.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
  }

  return res;
}

export const config = {
  matcher: ['/dashboard/:path*', '/r/:path*'],
};
