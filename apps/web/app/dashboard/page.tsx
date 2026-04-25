/**
 * /dashboard — account dashboard (issue #80).
 *
 * Server Component. SSR-fetches /api/dashboard/summary using the wb_session
 * HttpOnly cookie that PR #95 plants on successful magic-link verification.
 *
 * Behaviour:
 *   - 200 → render <DashboardView/> with the summary payload.
 *   - 401 → redirect to /sign-in. Per spec §3 + §2 #20 we don't surface
 *           server-side errors that could leak account state.
 *   - any other status → fall through to a generic error message (renders
 *                        in the same layout chrome).
 *
 * CSP §5.10: this page renders only static markup (no client hooks, no
 *           inline <script>, no style="" attributes). The middleware in
 *           apps/web/middleware.ts already attaches the strict CSP header
 *           for /dashboard/*.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DashboardView, type DashboardSummary } from './DashboardView';

// Force SSR — this page must read the request's cookie on every load.
// Without this, Next.js may statically pre-render at build time, which would
// 401 (no cookie at build time).
export const dynamic = 'force-dynamic';

/**
 * Resolve the API base URL for server-side fetches.
 *
 * In production the API and web are deployed behind the same hostname, so
 * a relative URL ("/api/dashboard/summary") routed via nginx is the
 * idiomatic shape. Server Components, however, run inside Node and need an
 * absolute URL for fetch(). Honour env overrides first; fall back to the
 * Vercel/Next default localhost port for dev.
 */
function apiBaseUrl(): string {
  const explicit = process.env['WILLBUY_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://127.0.0.1:3000';
}

async function fetchSummary(cookieHeader: string): Promise<
  | { ok: true; data: DashboardSummary }
  | { ok: false; status: number }
> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/dashboard/summary`, {
      headers: { cookie: cookieHeader },
      // Each request must hit the API — no Next.js cache.
      cache: 'no-store',
    });
  } catch {
    // Network / connect-refused. Surface as a generic 500.
    return { ok: false, status: 0 };
  }
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const data = (await res.json()) as DashboardSummary;
  return { ok: true, data };
}

export default async function DashboardPage(): Promise<JSX.Element> {
  // In Next 14 cookies() is sync; in Next 15 it became async. Cast to
  // accommodate both without pulling in version-specific types.
  const cookieStore = (cookies() as unknown) as {
    getAll: () => Array<{ name: string; value: string }>;
  };
  const all = cookieStore.getAll();
  const cookieHeader = all.map((c) => `${c.name}=${c.value}`).join('; ');

  // Without a wb_session cookie the API will 401; redirect early.
  const hasSession = all.some(
    (c) => c.name === 'wb_session' || c.name === '__Host-wb_session',
  );
  if (!hasSession) {
    redirect('/sign-in');
  }

  const result = await fetchSummary(cookieHeader);

  if (!result.ok) {
    if (result.status === 401) {
      redirect('/sign-in');
    }
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard unavailable</h1>
        <p className="mt-2 text-sm text-gray-600">
          We could not load your account just now. Please refresh the page; if
          the problem persists, contact support.
        </p>
      </main>
    );
  }

  return <DashboardView summary={result.data} />;
}
