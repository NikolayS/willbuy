/**
 * /dashboard/studies — paginated list of the caller's studies (issue #85).
 *
 * Server Component. SSR-fetches /api/studies?limit=20[&cursor=…] using the
 * wb_session HttpOnly cookie that PR #95 plants on magic-link verification.
 * Pagination is link-based ("Load more" → /dashboard/studies?cursor=<next>),
 * which keeps the page CSP-strict (no JS state) and back/forward-friendly.
 *
 * Behaviour:
 *   - 200 → render <StudiesListView/> with the API payload.
 *   - 401 → redirect to /sign-in (per spec §3 + §2 #20 we don't surface
 *           server-side errors that could leak account state).
 *   - any other status → fall through to a generic error message in the
 *                       same dashboard layout chrome.
 *
 * CSP §5.10: this page renders only static markup (no client hooks, no
 *           inline <script>, no style="" attributes). The middleware in
 *           apps/web/middleware.ts already attaches the strict CSP header
 *           for /dashboard/*.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  StudiesListView,
  type StudiesListResponse,
  type StudyListRow,
} from './StudiesListView';

// Force SSR — this page must read the request's cookie on every load.
export const dynamic = 'force-dynamic';

/**
 * Resolve the API base URL for server-side fetches.
 *
 * In production, API and web share a hostname behind nginx and a relative
 * URL would be idiomatic. Server Components run inside Node and need an
 * absolute URL for fetch(); honour env overrides first, fall back to dev.
 */
function apiBaseUrl(): string {
  const explicit = process.env['WILLBUY_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://127.0.0.1:3000';
}

async function fetchStudies(
  cookieHeader: string,
  cursor: string | undefined,
): Promise<{ ok: true; data: StudiesListResponse } | { ok: false; status: number }> {
  const qs = new URLSearchParams({ limit: '20' });
  if (cursor) qs.set('cursor', cursor);
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/studies?${qs.toString()}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const data = (await res.json()) as StudiesListResponse;
  // Light shape sanity — we trust the API but coerce defensively.
  if (!Array.isArray(data.studies)) {
    return { ok: false, status: 502 };
  }
  return { ok: true, data };
}

interface PageProps {
  // Next.js 14 App Router: searchParams may be a plain object or a Promise.
  searchParams?: Promise<Record<string, string | string[] | undefined>>
                 | Record<string, string | string[] | undefined>;
}

export default async function StudiesListPage(props: PageProps): Promise<JSX.Element> {
  // Read cookies — Next 14 sync, Next 15 async; cast covers both.
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

  // Resolve the cursor query param — handle both Promise- and plain-object
  // forms of searchParams to stay forward-compatible with Next.js 15.
  let sp: Record<string, string | string[] | undefined> = {};
  if (props.searchParams) {
    sp = props.searchParams instanceof Promise
      ? await props.searchParams
      : props.searchParams;
  }
  const rawCursor = sp['cursor'];
  const cursor = typeof rawCursor === 'string' && rawCursor.length > 0 ? rawCursor : undefined;

  const result = await fetchStudies(cookieHeader, cursor);

  if (!result.ok) {
    if (result.status === 401) {
      redirect('/sign-in');
    }
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Studies unavailable</h1>
        <p className="mt-2 text-sm text-gray-600">
          We could not load your studies just now. Please refresh the page; if
          the problem persists, contact support.
        </p>
      </main>
    );
  }

  // Coerce to the typed view contract.
  const studies: StudyListRow[] = result.data.studies as StudyListRow[];

  return (
    <StudiesListView studies={studies} nextCursor={result.data.next_cursor} />
  );
}
