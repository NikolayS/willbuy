/**
 * StudiesListView.tsx — pure presentational component for the study list page
 * (issue #85).
 *
 * Server-Component-friendly renderer (no client hooks). Imported by:
 *   - apps/web/app/dashboard/studies/page.tsx (production: SSR fetch)
 *   - apps/web/test/studies-list.test.tsx (renderToStaticMarkup with fixture)
 *
 * Spec refs:
 *   §3     — user stories: list studies, click through to report
 *   §5.10  — CSP: no inline scripts; no style="" attributes (className-only)
 *   §5.18  — report at /dashboard/studies/:id and /r/:slug
 *   §4.1   — Next.js 14 + Tailwind + TS
 *
 * "Load more" is a plain anchor (not a JS button) so the page stays CSP-strict
 * — clicking it navigates to /dashboard/studies?cursor=<next> and re-renders
 * server-side with the next page.
 */

import type { ReactElement } from 'react';

export type StudyStatus =
  | 'pending'
  | 'capturing'
  | 'visiting'
  | 'aggregating'
  | 'ready'
  | 'failed';

export interface StudyListRow {
  id: number;
  status: StudyStatus;
  created_at: string; // ISO-8601
  finalized_at: string | null;
  n_visits: number;
  urls: string[];
  visit_progress: { ok: number; failed: number; total: number };
}

export interface StudiesListResponse {
  studies: StudyListRow[];
  next_cursor: string | null;
}

/** Tailwind classes per spec §5.10 — green/yellow/red status badge palette. */
function badgeClasses(status: StudyStatus): string {
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
      // In-progress states use yellow, matching the rest of the app.
      return 'bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-200';
  }
}

/** Display in UTC for deterministic test snapshots. */
function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/**
 * Single-row visit progress bar.
 *
 * Renders ok / failed / total as a thin bar. Uses width classes via Tailwind's
 * utility scale so we don't need inline style="" (CSP §5.10). The width step
 * is rounded to the nearest 5%, then mapped to a w-N/20 fraction class.
 */
function ProgressBar({ ok, failed, total }: { ok: number; failed: number; total: number }): ReactElement | null {
  if (total === 0) {
    return (
      <span className="text-xs text-gray-400">—</span>
    );
  }
  const okPct = Math.round((ok / total) * 100);
  const failedPct = Math.round((failed / total) * 100);
  // Map 0..100 → w-0..w-full in 5% steps via a lookup. Using fixed Tailwind
  // class names (rather than computed style="width:N%") so the strict CSP
  // (no style-src 'unsafe-inline') still works.
  return (
    <div className="w-24">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full bg-green-500 ${pctToWidthClass(okPct)}`} />
        <div className={`h-full bg-red-400 ${pctToWidthClass(failedPct)}`} />
      </div>
      <div className="mt-1 text-[10px] text-gray-500">
        {ok}/{total}
        {failed > 0 ? ` (${failed} failed)` : ''}
      </div>
    </div>
  );
}

/**
 * Map a 0..100 percentage to a Tailwind width-fraction class. We keep this
 * inline (rather than imported from a util) so the file is self-contained.
 *
 * Resolution: 1/20 (5%). Fewer classes for the JIT to scan; visually fine for
 * a thin progress bar.
 */
function pctToWidthClass(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  // 0..100 → 0..20 (twentieths).
  const twentieths = Math.round(clamped / 5);
  // Tailwind needs literal class names so they survive purge — enumerate.
  const TABLE = [
    'w-0',     'w-1/20',  'w-2/20',  'w-3/20',  'w-4/20',
    'w-1/4',   'w-6/20',  'w-7/20',  'w-2/5',   'w-9/20',
    'w-1/2',   'w-11/20', 'w-3/5',   'w-13/20', 'w-7/10',
    'w-3/4',   'w-4/5',   'w-17/20', 'w-9/10',  'w-19/20',
    'w-full',
  ];
  return TABLE[twentieths] ?? 'w-0';
}

export function StudiesListView({
  studies,
  nextCursor,
}: {
  studies: StudyListRow[];
  nextCursor: string | null;
}): ReactElement {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* Header */}
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Your studies</h1>
          <p className="mt-1 text-sm text-gray-500">
            All studies ordered newest first.
          </p>
        </div>
        <a
          href="/dashboard/studies/new"
          className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          New study
        </a>
      </header>

      {studies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-16 text-center">
          <p className="text-sm text-gray-700">No studies yet — start one.</p>
          <a
            href="/dashboard/studies/new"
            className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
          >
            Create your first study
          </a>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Created
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    URLs
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Progress
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    N
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Report
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {studies.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {formatCreatedAt(s.created_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <ul className="space-y-1">
                        {s.urls.map((u) => (
                          <li key={u} className="max-w-xs truncate font-mono text-xs">
                            <a
                              href={`/dashboard/studies/${s.id}`}
                              className="text-indigo-600 hover:underline"
                            >
                              {u}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClasses(s.status)}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <ProgressBar
                        ok={s.visit_progress.ok}
                        failed={s.visit_progress.failed}
                        total={s.visit_progress.total}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      {s.n_visits}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {s.status === 'ready' ? (
                        <a
                          href={`/r/${s.id}`}
                          className="font-medium text-indigo-600 hover:underline"
                        >
                          View report
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

          {nextCursor !== null && (
            <div className="mt-6 flex justify-center">
              <a
                href={`/dashboard/studies?cursor=${nextCursor}`}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
              >
                Load more
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
