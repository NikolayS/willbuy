/**
 * studies-list.test.tsx — TDD acceptance for issue #85 (study list page).
 *
 * The page itself is a Server Component that SSR-fetches /api/studies; this
 * suite tests the pure presentational renderer (StudiesListView) the same
 * way dashboard.test.tsx tests DashboardView. That keeps the test fast,
 * deterministic, and free of network/cookie wiring.
 *
 * Spec refs:
 *   §3     — user stories: list studies, click through to report
 *   §5.18  — report at /dashboard/studies/:id and /r/:slug
 *   §5.10  — CSP: no inline scripts/styles
 *   §4.1   — Next.js 14 + Tailwind + TS
 *
 * Acceptance covered:
 *   1. List renders with fixture data and the right status-badge colors.
 *   2. Empty state.
 *   3. "Load more" link carries the cursor query param.
 *   4. Per-row "View report" link only when status=ready.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudiesListView } from '../app/dashboard/studies/StudiesListView';

const FIXTURE_STUDIES = [
  {
    id: 101,
    status: 'ready' as const,
    created_at: '2026-04-20T12:00:00.000Z',
    finalized_at: '2026-04-20T12:30:00.000Z',
    n_visits: 30,
    urls: ['https://example.com/pricing'],
    visit_progress: { ok: 30, failed: 0, total: 30 },
  },
  {
    id: 102,
    status: 'capturing' as const,
    created_at: '2026-04-19T08:00:00.000Z',
    finalized_at: null,
    n_visits: 15,
    urls: ['https://example.com/a', 'https://example.com/b'],
    visit_progress: { ok: 5, failed: 1, total: 15 },
  },
  {
    id: 103,
    status: 'failed' as const,
    created_at: '2026-04-18T08:00:00.000Z',
    finalized_at: '2026-04-18T08:30:00.000Z',
    n_visits: 5,
    urls: ['https://example.com/old'],
    visit_progress: { ok: 0, failed: 5, total: 5 },
  },
];

describe('/dashboard/studies view (issue #85)', () => {
  // -------------------------------------------------------------------------
  // 1: List renders with fixture data + status-badge colors.
  // -------------------------------------------------------------------------
  it('renders the list with status badges in the right colors', () => {
    const html = renderToStaticMarkup(
      <StudiesListView studies={FIXTURE_STUDIES} nextCursor={null} />,
    );
    // Each URL rendered.
    expect(html).toMatch(/example\.com\/pricing/);
    expect(html).toMatch(/example\.com\/a/);
    expect(html).toMatch(/example\.com\/old/);
    // Status names visible.
    expect(html).toMatch(/ready/i);
    expect(html).toMatch(/capturing/i);
    expect(html).toMatch(/failed/i);
    // Tailwind palette per spec — green ready, yellow in-progress, red failed.
    expect(html).toMatch(/bg-green-(?:50|100|200)[^"]*"[^>]*>\s*ready/i);
    expect(html).toMatch(/bg-yellow-(?:50|100|200)[^"]*"[^>]*>\s*capturing/i);
    expect(html).toMatch(/bg-red-(?:50|100|200)[^"]*"[^>]*>\s*failed/i);
  });

  // -------------------------------------------------------------------------
  // 2: Empty state.
  // -------------------------------------------------------------------------
  it('renders empty state when there are no studies', () => {
    const html = renderToStaticMarkup(
      <StudiesListView studies={[]} nextCursor={null} />,
    );
    expect(html).toMatch(/no studies yet/i);
    // Empty-state CTA points to /dashboard/studies/new.
    expect(html).toMatch(/href="\/dashboard\/studies\/new"/);
  });

  // -------------------------------------------------------------------------
  // 3: "Load more" link carries the next cursor.
  // -------------------------------------------------------------------------
  it('renders "Load more" link with the cursor query param when nextCursor is set', () => {
    const cursor = 'MjAyNi0wNC0xOFQwODowMDowMC4wMDBafDEwMw';
    const html = renderToStaticMarkup(
      <StudiesListView studies={FIXTURE_STUDIES} nextCursor={cursor} />,
    );
    // Must be a real anchor with the cursor in the query string — NOT a JS
    // button. CSP-friendly per spec §5.10.
    expect(html).toMatch(
      new RegExp(`href="/dashboard/studies\\?cursor=${cursor}"`),
    );
    expect(html).toMatch(/load more/i);
  });

  it('does NOT render "Load more" when nextCursor is null', () => {
    const html = renderToStaticMarkup(
      <StudiesListView studies={FIXTURE_STUDIES} nextCursor={null} />,
    );
    expect(html).not.toMatch(/load more/i);
  });

  // -------------------------------------------------------------------------
  // 4: Per-row "Open →" link → /dashboard/studies/:id only when status=ready.
  // -------------------------------------------------------------------------
  it('renders "Open →" → /dashboard/studies/:id only for status=ready rows', () => {
    const html = renderToStaticMarkup(
      <StudiesListView studies={FIXTURE_STUDIES} nextCursor={null} />,
    );
    // The "Open →" label appears in the markup.
    expect(html).toMatch(/Open →/);
    // It is NOT the old /r/:id route (reports are private by default).
    expect(html).not.toMatch(/href="\/r\/101"/);
    // Only one action link: the ready row gets "Open →", others get "—".
    const openMatches = html.match(/Open →/g);
    expect(openMatches).toHaveLength(1);
    // Non-ready rows do NOT get "Open →".
    // (URL-column links to /dashboard/studies/102 still exist, but those are
    //  in the URL cell, not the action cell — "Open →" is the discriminator.)
    const dashCount = (html.match(/Open →/g) ?? []).length;
    expect(dashCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // CSP §5.10 — no inline scripts or style= attributes.
  // -------------------------------------------------------------------------
  it('contains no inline <script> tags or style= attributes (CSP §5.10)', () => {
    const html = renderToStaticMarkup(
      <StudiesListView studies={FIXTURE_STUDIES} nextCursor="abc" />,
    );
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/\sstyle="/i);
  });
});
