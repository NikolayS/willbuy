/**
 * /dashboard layout — minimal topbar with sign-out (issue #80).
 *
 * Wraps every /dashboard/* route. Sub-issues #81 (API keys), #82 (domain
 * verification), #83 (per-study detail), #85 (study list) inherit this
 * shell so navigation stays consistent across the dashboard surface.
 *
 * Sign-out: a plain HTML <form action="/api/auth/sign-out" method="post">
 * which the API redirects to /sign-in after clearing the wb_session cookie
 * (apps/api/src/routes/auth.ts). Spec §5.10 — this is form-action='self'
 * so it is permitted under the dashboard CSP.
 *
 * CSP refs: §5.10 — no inline scripts/styles. The form posts via the
 * browser's native form-submit (no JavaScript).
 */

import type { ReactNode } from 'react';

// Force dynamic rendering for the entire /dashboard/* tree.
//
// Without this, Next.js 14 statically pre-renders client-component pages
// (e.g. /dashboard/studies/new — `'use client'`) and caches the HTML.
// The cached HTML's inline-script `nonce=` attributes are baked at
// build/cache time, but the per-request CSP `nonce-...` directive is
// generated fresh in middleware.ts on every request. The result is a
// nonce mismatch — the browser's CSP enforcer blocks all inline scripts,
// React never hydrates, and forms submit as plain HTML GET (the user
// reported on 2026-04-28: slider doesn't update, "Add second URL" link
// doesn't work, "Start study" button does nothing).
//
// `force-dynamic` tells Next.js to render this segment per-request, so
// the inline scripts are stamped with the live nonce that matches the
// CSP header. Safe for client-component pages — they have no server
// data fetching to revalidate.
export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <a
            href="/dashboard"
            className="text-sm font-semibold tracking-tight text-gray-900 hover:text-gray-700"
          >
            willbuy.dev
          </a>
          <nav className="flex items-center gap-5 text-sm text-gray-600">
            <a href="/dashboard" className="hover:text-gray-900">
              Dashboard
            </a>
            <a href="/dashboard/studies/new" className="hover:text-gray-900">
              New study
            </a>
            <a href="/dashboard/domains" className="hover:text-gray-900">
              Domains
            </a>
            <a href="/dashboard/credits" className="hover:text-gray-900">
              Credits
            </a>
            <form action="/api/auth/sign-out" method="post" className="inline">
              <button
                type="submit"
                className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
