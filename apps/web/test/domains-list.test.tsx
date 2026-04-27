/**
 * domains-list.test.tsx — TDD acceptance tests for issue #83 (domain list page).
 *
 * Spec refs:
 *   §2 #1  — verified-domain authorization (status badges differentiate
 *            verified vs. pending challenges).
 *   §4.1   — Next.js 14 App Router + Tailwind.
 *   §5.10  — CSP: no inline scripts; action buttons use native HTML <form>
 *            posts (no JS) so the page works under the strict CSP.
 *
 * Component under test: app/dashboard/domains/DomainsListView.tsx — a pure
 * presentational renderer used by app/dashboard/domains/page.tsx (the
 * Server Component that SSR-fetches GET /api/domains).
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DomainsListView } from '../app/dashboard/domains/DomainsListView';

const VERIFIED = {
  domain: 'verified.example',
  verify_token: 'tok-verified-zzzzzzzzzz',
  verified_at: '2026-04-20T12:00:00.000Z',
  last_checked_at: '2026-04-20T12:00:00.000Z',
  created_at: '2026-04-20T12:00:00.000Z',
};

const PENDING = {
  domain: 'pending.example',
  verify_token: 'tok-pending-zzzzzzzzzzz',
  verified_at: null,
  last_checked_at: '2026-04-21T08:00:00.000Z',
  created_at: '2026-04-21T08:00:00.000Z',
};

describe('/dashboard/domains list view (issue #83)', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // AC1: Table renders rows with correct status badges.
  // ──────────────────────────────────────────────────────────────────────────
  it('renders one row per domain with correct status (verified vs pending)', () => {
    const html = renderToStaticMarkup(
      <DomainsListView domains={[VERIFIED, PENDING]} />,
    );

    // Both domain names appear.
    expect(html).toMatch(/verified\.example/);
    expect(html).toMatch(/pending\.example/);

    // Status text differentiates the two.
    // We accept either textual ("Verified" / "Pending") or symbolic ("✅" / "⏳")
    // — the implementation may use either; what matters is they differ.
    const hasVerifiedBadge = /verified\.example[\s\S]*?(?:Verified|✅)/i.test(html)
      || /(?:Verified|✅)[\s\S]*?verified\.example/i.test(html);
    const hasPendingBadge = /pending\.example[\s\S]*?(?:Pending|⏳)/i.test(html)
      || /(?:Pending|⏳)[\s\S]*?pending\.example/i.test(html);
    expect(hasVerifiedBadge).toBe(true);
    expect(hasPendingBadge).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC2: Empty state.
  // ──────────────────────────────────────────────────────────────────────────
  it('renders the empty-state CTA when there are no domains', () => {
    const html = renderToStaticMarkup(<DomainsListView domains={[]} />);
    expect(html).toMatch(/no domains yet/i);
    // CTA links to /dashboard/domains/new (the verify-flow page from PR #103).
    expect(html).toMatch(/href="\/dashboard\/domains\/new"/);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC3: Re-verify form posts to the existing verify endpoint (PR #103).
  // ──────────────────────────────────────────────────────────────────────────
  it('renders a Re-verify <form> targeting POST /api/domains/<domain>/verify (CSP-safe, no JS)', () => {
    const html = renderToStaticMarkup(<DomainsListView domains={[VERIFIED]} />);
    // The form action MUST be the verify endpoint for this exact domain.
    // Native <form action="..." method="post"> works under the dashboard's
    // strict CSP because it has no inline JS.
    expect(html).toMatch(
      /<form[^>]*action="\/api\/domains\/verified\.example\/verify"[^>]*method="post"/i,
    );
    // Re-verify button label.
    expect(html).toMatch(/Re-verify/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC4: Remove form posts to a CSP-safe endpoint that the API treats as DELETE.
  // ──────────────────────────────────────────────────────────────────────────
  it('renders a Remove <form> targeting POST /api/domains/<domain>/delete (CSP-safe form workaround)', () => {
    const html = renderToStaticMarkup(<DomainsListView domains={[VERIFIED]} />);
    // HTML forms can only emit GET or POST, so the API exposes a sibling
    // POST .../delete that internally executes the same SQL as DELETE
    // and 302-redirects back to /dashboard/domains.
    expect(html).toMatch(
      /<form[^>]*action="\/api\/domains\/verified\.example\/delete"[^>]*method="post"/i,
    );
    expect(html).toMatch(/Remove/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC5: Top-of-page "Add domain" CTA is always present.
  // ──────────────────────────────────────────────────────────────────────────
  it('renders an Add-domain CTA linking to /dashboard/domains/new', () => {
    const html = renderToStaticMarkup(<DomainsListView domains={[VERIFIED]} />);
    // It's a plain anchor (no JS) to the new-domain flow page.
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/domains\/new"[^>]*>[\s\S]*?Add domain/i);
  });
});

// ── formatTs — observable via DomainsListView rendered output ─────────────

describe('DomainsListView — formatTs timestamp display', () => {
  it('null verified_at renders an em-dash placeholder', () => {
    // PENDING has verified_at: null → formatTs(null) → '—'.
    const html = renderToStaticMarkup(
      <DomainsListView domains={[PENDING]} />,
    );
    // The em-dash '—' must appear for the null verified_at cell.
    expect(html).toContain('—'); // U+2014 em dash
  });

  it('valid ISO verified_at renders in YYYY-MM-DD HH:MM UTC format', () => {
    // VERIFIED.verified_at = '2026-04-20T12:00:00.000Z' → '2026-04-20 12:00 UTC'
    const html = renderToStaticMarkup(
      <DomainsListView domains={[VERIFIED]} />,
    );
    expect(html).toContain('2026-04-20 12:00 UTC');
  });

  it('invalid date string is returned unchanged (no NaN)', () => {
    const withBadDate = {
      ...VERIFIED,
      last_checked_at: 'not-a-date',
    };
    const html = renderToStaticMarkup(
      <DomainsListView domains={[withBadDate]} />,
    );
    expect(html).toContain('not-a-date');
    expect(html).not.toContain('NaN');
  });
});
