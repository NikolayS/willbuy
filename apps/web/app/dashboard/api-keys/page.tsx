/**
 * /dashboard/api-keys — list user's API keys (issue #81).
 *
 * Server Component. SSR-fetches GET /api/api-keys with the wb_session cookie
 * forwarded from the browser (PR #95 plants the cookie on magic-link verify).
 *
 * Behaviour:
 *   - 200 → render <ApiKeysView keys=…/>
 *   - 401 → redirect to /sign-in (no leak per spec §3, §2 #20)
 *   - other → fall through to a generic error message in the same chrome
 *
 * CSP §5.10: no inline scripts, no style="" attributes. The "Revoke" button
 * is a plain <form method="post"> targeting /dashboard/api-keys/:id/revoke
 * (handled by the route.ts in this folder). No client JS — the redirect
 * after revoke is server-side via Next.js redirect() returning 303.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiKeysView, type ApiKeyRow } from './ApiKeysView';

export const dynamic = 'force-dynamic';

function apiBaseUrl(): string {
  const explicit = process.env['WILLBUY_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://127.0.0.1:3000';
}

async function fetchKeys(
  cookieHeader: string,
): Promise<{ ok: true; data: ApiKeyRow[] } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/api-keys`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as ApiKeyRow[];
  return { ok: true, data };
}

export default async function ApiKeysPage(): Promise<JSX.Element> {
  const cookieStore = (cookies() as unknown) as {
    getAll: () => Array<{ name: string; value: string }>;
  };
  const all = cookieStore.getAll();
  const cookieHeader = all.map((c) => `${c.name}=${c.value}`).join('; ');

  const hasSession = all.some(
    (c) => c.name === 'wb_session' || c.name === '__Host-wb_session',
  );
  if (!hasSession) {
    redirect('/sign-in');
  }

  const result = await fetchKeys(cookieHeader);

  if (!result.ok) {
    if (result.status === 401) redirect('/sign-in');
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">API keys unavailable</h1>
        <p className="mt-2 text-sm text-gray-600">
          We could not load your keys just now. Please refresh the page; if the
          problem persists, contact support.
        </p>
      </main>
    );
  }

  return <ApiKeysView keys={result.data} />;
}
