/**
 * /dashboard/api-keys/:id/revoke — POST-only Route Handler (issue #81).
 *
 * Receives the per-row "Revoke" form submission from /dashboard/api-keys
 * and forwards a real DELETE /api/api-keys/:id to the API. Then redirects
 * (303) back to /dashboard/api-keys so the user sees the updated list.
 *
 * Why a Route Handler: same reasoning as create/route.ts — strict CSP
 * does not allow the inline JS that a client-side `fetch('DELETE')`
 * approach would require. A vanilla form POST is CSP-clean.
 *
 * Spec refs:
 *   §4.1, §5.10 (CSP), §2 #20 (no leak).
 */

import { NextResponse, type NextRequest } from 'next/server';

function apiBaseUrl(): string {
  const explicit = process.env['WILLBUY_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://127.0.0.1:3000';
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  // Validate id is a positive integer to avoid forwarding garbage.
  if (!/^[1-9]\d*$/.test(params.id)) {
    return NextResponse.redirect(new URL('/dashboard/api-keys', req.url), 303);
  }

  const cookieHeader = req.headers.get('cookie') ?? '';

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/api-keys/${params.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.redirect(
      new URL(
        '/dashboard/api-keys?error=' + encodeURIComponent('Revoke failed — API unreachable'),
        req.url,
      ),
      303,
    );
  }

  if (res.status === 401) {
    return NextResponse.redirect(new URL('/sign-in', req.url), 303);
  }
  // For 200 (success) and 404 (already revoked / not found) we redirect
  // back to the list either way. The list will reflect the current state.
  return NextResponse.redirect(new URL('/dashboard/api-keys', req.url), 303);
}
