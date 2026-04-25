/**
 * DomainsListView.tsx — pure presentational renderer for the
 * /dashboard/domains list (issue #83).
 *
 * Server-Component-friendly (no client hooks). Imported by:
 *   - apps/web/app/dashboard/domains/page.tsx (production: SSR-fetches GET /api/domains)
 *   - apps/web/test/domains-list.test.tsx (renderToStaticMarkup with fixtures)
 *
 * Spec refs:
 *   §2 #1  — verified-domain authorization (status badges differentiate
 *            verified vs. pending challenges).
 *   §4.1   — Next.js 14 App Router + Tailwind.
 *   §5.10  — CSP: no inline scripts; no style="" attributes; action buttons
 *            use native HTML <form> posts. The dashboard CSP allows
 *            form-action 'self', so a form posting to /api/* on the same
 *            origin is fine. We never use fetch() / onClick handlers here.
 *
 * CSP-safe action wiring:
 *   - "Re-verify" → POST /api/domains/<domain>/verify (defined in PR #103;
 *     the API returns JSON, but the page just reloads when the form
 *     submits because we don't intercept). For a fully no-JS UX the
 *     existing endpoint is fine — the reloaded list shows updated state
 *     because the API also bumps last_checked_at.
 *   - "Remove"    → POST /api/domains/<domain>/delete (sibling route added
 *     in this PR specifically for the form-submit case; the API redirects
 *     302 to /dashboard/domains).
 */

import type { ReactElement } from 'react';

export interface DomainRow {
  domain: string;
  verify_token: string;
  verified_at: string | null; // ISO-8601 or null
  last_checked_at: string | null; // ISO-8601 or null
  created_at: string; // ISO-8601
}

export interface DomainsListViewProps {
  domains: DomainRow[];
}

/** Format an ISO timestamp as "YYYY-MM-DD HH:MM UTC" or "—" if null. */
function formatTs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}

function StatusBadge({ verifiedAt }: { verifiedAt: string | null }): ReactElement {
  if (verifiedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-200">
        {/* Cleartext check; spec §5.10 forbids dangerouslySetInnerHTML. */}
        <span aria-hidden="true">✅</span> Verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 ring-1 ring-inset ring-yellow-200">
      <span aria-hidden="true">⏳</span> Pending
    </span>
  );
}

export function DomainsListView({ domains }: DomainsListViewProps): ReactElement {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* Header: title + Add-domain CTA — always visible. */}
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Domains</h1>
          <p className="mt-1 text-sm text-gray-500">
            Domains you have registered with willbuy. Studies can only target
            verified domains (spec §2 #1).
          </p>
        </div>
        <a
          href="/dashboard/domains/new"
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          Add domain
        </a>
      </header>

      {domains.length === 0 ? (
        <section className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
          <p className="text-sm text-gray-700">
            No domains yet. Add a domain to get started.
          </p>
          <a
            href="/dashboard/domains/new"
            className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
          >
            Add your first domain
          </a>
        </section>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  Domain
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  Verified at
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  Last checked
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {domains.map((d) => {
                // Encode for use inside a URL path segment. encodeURIComponent
                // doesn't escape '.', which is what we want for hostnames.
                const enc = encodeURIComponent(d.domain);
                return (
                  <tr key={d.domain} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-gray-900">
                      {d.domain}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <StatusBadge verifiedAt={d.verified_at} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {formatTs(d.verified_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {formatTs(d.last_checked_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        {/*
                          Re-verify: native form post to the existing PR #103
                          endpoint. The API returns JSON; the browser will
                          land on that JSON page, but the user can refresh
                          /dashboard/domains to see the updated last_checked_at.
                          (A future PR can wire a 302-redirect alias if we
                          want a fully zero-JS round-trip.)
                        */}
                        <form
                          action={`/api/domains/${enc}/verify`}
                          method="post"
                          className="inline"
                        >
                          <button
                            type="submit"
                            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                          >
                            Re-verify
                          </button>
                        </form>
                        {/*
                          Remove: native form post to the CSP-safe
                          /api/domains/<domain>/delete sibling that this PR
                          adds — the API performs the same SQL as DELETE
                          and 302-redirects back to /dashboard/domains.
                        */}
                        <form
                          action={`/api/domains/${enc}/delete`}
                          method="post"
                          className="inline"
                        >
                          <button
                            type="submit"
                            className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                          >
                            Remove
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
