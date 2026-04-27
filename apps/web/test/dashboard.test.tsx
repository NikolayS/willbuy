/**
 * dashboard.test.tsx — TDD acceptance for issue #80 (account dashboard).
 *
 * Spec refs:
 *   §3     — user stories (balance, recent studies, buy credits CTA)
 *   §5.10  — CSP: no inline scripts/styles
 *   §4.1   — Next.js 14 + Tailwind + TS
 *
 * Tests cover the rendered output given a fixture summary. The page is a
 * Server Component that fetches /api/dashboard/summary and renders. Here we
 * test the renderer directly by importing the pure presentational component
 * (DashboardView) and feeding it the same shape the server fetch returns.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardView } from '../app/dashboard/DashboardView';

const FIXTURE_SUMMARY = {
  email: 'jane@example.com',
  balance_cents: 4250,
  recent_studies: [
    {
      id: 101,
      status: 'ready' as const,
      created_at: '2026-04-20T12:00:00.000Z',
      n_visits: 30,
      urls: ['https://example.com/pricing'],
    },
    {
      id: 102,
      status: 'capturing' as const,
      created_at: '2026-04-19T08:00:00.000Z',
      n_visits: 15,
      urls: ['https://example.com/a', 'https://example.com/b'],
    },
    {
      id: 103,
      status: 'failed' as const,
      created_at: '2026-04-18T08:00:00.000Z',
      n_visits: 5,
      urls: ['https://example.com/old'],
    },
  ],
};

describe('/dashboard view (issue #80)', () => {
  // -------------------------------------------------------------------------
  // 1: Renders balance + studies list.
  // -------------------------------------------------------------------------
  it('renders the balance ($X.XX) and recent studies list', () => {
    const html = renderToStaticMarkup(<DashboardView summary={FIXTURE_SUMMARY} />);
    // Balance formatted as USD.
    expect(html).toMatch(/\$42\.50/);
    // Email visible (welcome / topbar).
    expect(html).toMatch(/jane@example\.com/);
    // Each study URL rendered.
    expect(html).toMatch(/example\.com\/pricing/);
    expect(html).toMatch(/example\.com\/a/);
    expect(html).toMatch(/example\.com\/old/);
    // Status badges have the status names visible.
    expect(html).toMatch(/ready/i);
    expect(html).toMatch(/capturing/i);
    expect(html).toMatch(/failed/i);
  });

  // -------------------------------------------------------------------------
  // 2: Empty state.
  // -------------------------------------------------------------------------
  it('shows buy-credits prompt when balance is 0 and no studies', () => {
    const empty = { email: 'a@b.co', balance_cents: 0, recent_studies: [] };
    const html = renderToStaticMarkup(<DashboardView summary={empty} />);
    expect(html).toMatch(/buy credits/i);
    expect(html).toMatch(/need credits to run a study/i);
  });

  it('shows empty state with "start one" link when balance > 0 and no studies', () => {
    const empty = { email: 'a@b.co', balance_cents: 500, recent_studies: [] };
    const html = renderToStaticMarkup(<DashboardView summary={empty} />);
    expect(html).toMatch(/no studies yet/i);
  });

  // -------------------------------------------------------------------------
  // 3: Status badge colors (Tailwind classes).
  // -------------------------------------------------------------------------
  it('applies green/yellow/red Tailwind colors to badges by status', () => {
    const html = renderToStaticMarkup(<DashboardView summary={FIXTURE_SUMMARY} />);
    // Green for ready.
    expect(html).toMatch(/bg-green-(?:50|100|200)[^"]*"[^>]*>\s*ready/i);
    // Yellow for in-progress (capturing/visiting/aggregating/pending).
    expect(html).toMatch(/bg-yellow-(?:50|100|200)[^"]*"[^>]*>\s*capturing/i);
    // Red for failed.
    expect(html).toMatch(/bg-red-(?:50|100|200)[^"]*"[^>]*>\s*failed/i);
  });

  // -------------------------------------------------------------------------
  // 4: CTAs.
  // -------------------------------------------------------------------------
  it('renders "Buy credits" and "New study" CTAs with correct hrefs', () => {
    const html = renderToStaticMarkup(<DashboardView summary={FIXTURE_SUMMARY} />);
    expect(html).toMatch(/href="\/dashboard\/credits"/);
    expect(html).toMatch(/Buy credits/i);
    expect(html).toMatch(/href="\/dashboard\/studies\/new"/);
    expect(html).toMatch(/New study/i);
  });

  // -------------------------------------------------------------------------
  // 5: CSP §5.10 — no inline scripts or style= attributes.
  // -------------------------------------------------------------------------
  it('contains no inline <script> tags or style= attributes (CSP §5.10)', () => {
    const html = renderToStaticMarkup(<DashboardView summary={FIXTURE_SUMMARY} />);
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/\sstyle="/i);
  });
});

// ── formatCreatedAt + formatBalance — observable via DashboardView rendered output ──

describe('DashboardView — formatCreatedAt and formatBalance helpers', () => {
  const base = {
    email: 'x@example.com',
    recent_studies: [],
  };

  it('formatCreatedAt: valid ISO renders in YYYY-MM-DD HH:MM UTC format', () => {
    const summary = {
      ...base,
      balance_cents: 0,
      recent_studies: [
        {
          id: 1,
          status: 'ready' as const,
          created_at: '2026-04-20T12:00:00.000Z',
          n_visits: 1,
          urls: ['https://example.com'],
        },
      ],
    };
    const html = renderToStaticMarkup(<DashboardView summary={summary} />);
    expect(html).toContain('2026-04-20 12:00 UTC');
  });

  it('formatCreatedAt: invalid date string is returned unchanged (no NaN)', () => {
    const summary = {
      ...base,
      balance_cents: 0,
      recent_studies: [
        {
          id: 2,
          status: 'capturing' as const,
          created_at: 'not-a-date',
          n_visits: 1,
          urls: ['https://example.com'],
        },
      ],
    };
    const html = renderToStaticMarkup(<DashboardView summary={summary} />);
    expect(html).toContain('not-a-date');
    expect(html).not.toContain('NaN');
  });

  it('formatBalance: zero cents → $0.00', () => {
    const html = renderToStaticMarkup(<DashboardView summary={{ ...base, balance_cents: 0 }} />);
    expect(html).toContain('$0.00');
  });

  it('formatBalance: 1 cent → $0.01', () => {
    const html = renderToStaticMarkup(<DashboardView summary={{ ...base, balance_cents: 1 }} />);
    expect(html).toContain('$0.01');
  });
});
