/**
 * DashboardView.tsx — pure presentational component for the account dashboard
 * (issue #80).
 *
 * This is a Server-Component-friendly renderer (no client hooks). It is
 * imported by:
 *   - apps/web/app/dashboard/page.tsx (production: SSR-fetches the API)
 *   - apps/web/test/dashboard.test.tsx (renderToStaticMarkup with a fixture)
 *
 * Spec refs:
 *   §3     — user stories: balance, recent studies, buy credits CTA.
 *   §5.10  — CSP: no inline scripts; no style="" attributes (className-only).
 *   §4.1   — Next.js 14 + Tailwind + TS.
 */

import type { ReactElement } from 'react';

export type StudyStatus =
  | 'pending'
  | 'capturing'
  | 'visiting'
  | 'aggregating'
  | 'ready'
  | 'failed';

export interface DashboardStudy {
  id: number;
  status: StudyStatus;
  created_at: string; // ISO-8601
  n_visits: number;
  urls: string[];
}

export interface DashboardSummary {
  email: string;
  balance_cents: number;
  recent_studies: DashboardStudy[];
}

/** Format an integer cent amount as USD: 4250 → "$42.50". */
function formatBalance(cents: number): string {
  // Avoid Intl edge cases (locale-specific separators) for this small range —
  // explicit Math.floor + toFixed gives consistent "$X.XX" output.
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars}`;
}

/** Tailwind classes per spec §5.10 — green/yellow/red status badge palette. */
function badgeClasses(status: StudyStatus): string {
  // Using bg-{color}-100 + text-{color}-800 keeps WCAG contrast comfortable
  // and matches the rest of the app's badge style.
  switch (status) {
    case 'ready':
      return 'bg-green-100 text-green-800 ring-1 ring-inset ring-green-200';
    case 'failed':
      return 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-200';
    case 'pending':
    case 'capturing':
    case 'visiting':
    case 'aggregating':
    default:
      // In-progress states use yellow per the test acceptance.
      return 'bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-200';
  }
}

function formatCreatedAt(iso: string): string {
  // Display in UTC to keep snapshots deterministic across CI agents.
  // Format: 2026-04-20 12:00 UTC.
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

export function DashboardView({ summary }: { summary: DashboardSummary }): ReactElement {
  const { email, balance_cents, recent_studies } = summary;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* Header — greeting + email */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Signed in as <span className="font-medium text-gray-700">{email}</span>
        </p>
      </header>

      {/* Balance card + CTAs */}
      <section
        aria-labelledby="balance-heading"
        className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm md:col-span-2">
          <h2 id="balance-heading" className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Credit balance
          </h2>
          <p className="mt-2 text-4xl font-bold text-gray-900">
            {formatBalance(balance_cents)}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {balance_cents === 0 ? (
              <>Buy credits to run your first study. Starts at $29 for ~828 visits.</>
            ) : (
              <>
                Each visit costs up to 5¢. You can run up to{' '}
                <span className="font-medium text-gray-700">{Math.floor(balance_cents / 5)}</span>{' '}
                visits with this balance.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <a
            href="/dashboard/credits"
            className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Buy credits
          </a>
          <a
            href="/dashboard/studies/new"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            New study
          </a>
        </div>
      </section>

      {/* Recent studies */}
      <section aria-labelledby="studies-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="studies-heading" className="text-lg font-semibold text-gray-900">
            Recent studies
          </h2>
          <span className="text-xs text-gray-500">last 10</span>
        </div>

        {recent_studies.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
            {balance_cents === 0 ? (
              <>
                <p className="text-sm font-medium text-gray-700">You need credits to run a study.</p>
                <p className="mt-1 text-xs text-gray-500">
                  Each study runs N synthetic visitors at avg 3.5¢ each.
                </p>
                <a
                  href="/dashboard/credits"
                  className="mt-3 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
                >
                  Buy credits →
                </a>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-700">No studies yet — start one.</p>
                <a
                  href="/dashboard/studies/new"
                  className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
                >
                  Create your first study
                </a>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Study
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    URL{/* paired studies show two */}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    N
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Created
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recent_studies.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      <a
                        href={`/dashboard/studies/${s.id}`}
                        className="font-mono text-xs text-indigo-600 hover:underline"
                      >
                        #{s.id}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <ul className="space-y-1">
                        {s.urls.map((u) => (
                          <li key={u} className="truncate font-mono text-xs">
                            {u}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      {s.n_visits}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClasses(s.status)}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {formatCreatedAt(s.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {s.status === 'ready' ? (
                        <a href={`/r/${s.id}`} className="font-medium text-indigo-600 hover:underline text-xs">
                          View report →
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
