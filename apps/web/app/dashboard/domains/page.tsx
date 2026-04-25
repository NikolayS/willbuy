/**
 * /dashboard/domains — domain list page (issue #83).
 *
 * Server Component. SSR-fetches GET /api/domains using the wb_session
 * HttpOnly cookie that PR #95 plants on successful magic-link verification.
 *
 * Behaviour:
 *   - 200 → render <DomainsListView/> with the rows.
 *   - 401 → redirect to /sign-in. Per spec §3 + §2 #20 we don't surface
 *           server-side errors that could leak account state.
 *   - any other status → fall through to a generic error message.
 *
 * Spec refs:
 *   §2 #1  — verified-domain authorization (this is the management UI).
 *   §4.1   — Next.js 14 App Router + Tailwind.
 *   §5.10  — strict CSP attached by apps/web/middleware.ts on /dashboard/*.
 *            All action buttons in <DomainsListView/> are native HTML
 *            <form> posts (no inline JS).
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DomainsListView, type DomainRow } from './DomainsListView';

// Force SSR — this page must read the request's cookie on every load.
// Without this, Next.js may statically pre-render at build time, which would
// 401 (no cookie at build time).
export const dynamic = 'force-dynamic';

/**
 * Resolve the API base URL for server-side fetches.
 *
 * In production the API and web are deployed behind the same hostname, so
 * a relative URL ("/api/domains") routed via nginx is the idiomatic shape.
 * Server Components, however, run inside Node and need an absolute URL for
 * fetch(). Honour env overrides first; fall back to the dev port.
 *
 * Mirrors apps/web/app/dashboard/page.tsx (issue #80, PR #102).
 */
function apiBaseUrl(): string {
  const explicit = process.env['WILLBUY_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://127.0.0.1:3000';
}

async function fetchDomains(cookieHeader: string): Promise<
  | { ok: true; data: DomainRow[] }
  | { ok: false; status: number }
> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/domains`, {
      headers: { cookie: cookieHeader },
      // Each request must hit the API — no Next.js cache.
      cache: 'no-store',
    });
  } catch {
    // Network / connect-refused.
    return { ok: false, status: 0 };
  }
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const body = (await res.json()) as { domains: DomainRow[] };
  return { ok: true, data: body.domains };
}

export default async function DomainsListPage(): Promise<JSX.Element> {
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

  const result = await fetchDomains(cookieHeader);

  if (!result.ok) {
    if (result.status === 401) {
      redirect('/sign-in');
    }
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Domains unavailable</h1>
        <p className="mt-2 text-sm text-gray-600">
          We could not load your domains just now. Please refresh the page; if
          the problem persists, contact support.
        </p>
      </main>
    );
  }

  return <DomainsListView domains={result.data} />;
}
