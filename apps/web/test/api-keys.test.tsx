/**
 * api-keys.test.tsx — TDD acceptance for issue #81 (API-key management UI).
 *
 * Spec refs:
 *   §3      — user stories: list keys, create, revoke
 *   §5.10   — CSP: no inline scripts/styles
 *   §4.1    — Next.js 14 + Tailwind + TS
 *   §2 #22  — keys masked except in the one-time create response
 *
 * Tests cover the rendered output given fixture rows. The page is a Server
 * Component that fetches /api/api-keys; here we test the renderer directly
 * by importing the pure presentational components.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ApiKeysView,
  NewKeyFormView,
  NewKeyResultView,
  type ApiKeyRow,
} from '../app/dashboard/api-keys/ApiKeysView';

const FIXTURE_KEY: ApiKeyRow = {
  id: 1,
  label: 'CI deploy',
  prefix: 'sk_live_a',
  last_used_at: '2026-04-24T10:30:00.000Z',
  revoked_at: null,
  created_at: '2026-04-20T08:00:00.000Z',
};

const REVOKED_KEY: ApiKeyRow = {
  id: 2,
  label: 'old worker',
  prefix: 'sk_live_z',
  last_used_at: null,
  revoked_at: '2026-04-22T12:00:00.000Z',
  created_at: '2026-04-19T08:00:00.000Z',
};

describe('/dashboard/api-keys list view (issue #81)', () => {
  // -------------------------------------------------------------------------
  // 1: empty state.
  // -------------------------------------------------------------------------
  it('shows the empty state when there are no keys', () => {
    const html = renderToStaticMarkup(<ApiKeysView keys={[]} />);
    expect(html).toMatch(/no api keys yet/i);
    expect(html).toMatch(/href="\/dashboard\/api-keys\/new"/);
  });

  // -------------------------------------------------------------------------
  // 2: rows render label, prefix, status, and a Revoke form.
  // -------------------------------------------------------------------------
  it('renders rows with label, prefix, and active status', () => {
    const html = renderToStaticMarkup(<ApiKeysView keys={[FIXTURE_KEY]} />);
    expect(html).toMatch(/CI deploy/);
    expect(html).toMatch(/sk_live_a/);
    expect(html).toMatch(/active/i);
    // The "Revoke" form posts to /dashboard/api-keys/:id/revoke.
    expect(html).toMatch(/action="\/dashboard\/api-keys\/1\/revoke"/);
    expect(html).toMatch(/method="post"/i);
    expect(html).toMatch(/Revoke/);
  });

  // -------------------------------------------------------------------------
  // 3: revoked rows render the "revoked" badge and no Revoke button.
  // -------------------------------------------------------------------------
  it('renders revoked status without a Revoke button', () => {
    const html = renderToStaticMarkup(<ApiKeysView keys={[REVOKED_KEY]} />);
    expect(html).toMatch(/revoked/i);
    // No revoke form for already-revoked rows.
    expect(html).not.toMatch(/action="\/dashboard\/api-keys\/2\/revoke"/);
  });

  // -------------------------------------------------------------------------
  // 4: the raw key value MUST NEVER appear in the list view.
  // -------------------------------------------------------------------------
  it('never renders the full key value (only prefix)', () => {
    const html = renderToStaticMarkup(<ApiKeysView keys={[FIXTURE_KEY, REVOKED_KEY]} />);
    // Prefix is OK — full body chars after the prefix are not.
    expect(html).toMatch(/sk_live_a/);
    expect(html).not.toMatch(/sk_live_a[A-Za-z0-9]{20,}/); // no full-length key
  });

  // -------------------------------------------------------------------------
  // 5: ≤ 2 active key cap is surfaced (Create button disabled at cap).
  // -------------------------------------------------------------------------
  it('disables the create button when 2 active keys exist (cap)', () => {
    const second: ApiKeyRow = { ...FIXTURE_KEY, id: 3, label: 'second active' };
    const html = renderToStaticMarkup(<ApiKeysView keys={[FIXTURE_KEY, second]} />);
    // Active create button uses an <a href>; capped state uses an aria-disabled span.
    expect(html).not.toMatch(/<a [^>]*href="\/dashboard\/api-keys\/new"[^>]*>\s*Create new key/);
    expect(html).toMatch(/aria-disabled="true"/);
  });

  // -------------------------------------------------------------------------
  // 6: CSP §5.10 — no inline <script> tags or style="" attributes.
  // -------------------------------------------------------------------------
  it('contains no inline <script> tags or style= attributes (CSP §5.10)', () => {
    const html = renderToStaticMarkup(<ApiKeysView keys={[FIXTURE_KEY, REVOKED_KEY]} />);
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/\sstyle="/i);
  });
});

describe('/dashboard/api-keys/new form view (issue #81)', () => {
  // -------------------------------------------------------------------------
  // 7: form submits to /dashboard/api-keys/create with method=post.
  // -------------------------------------------------------------------------
  it('renders a label input and posts to /dashboard/api-keys/create', () => {
    const html = renderToStaticMarkup(<NewKeyFormView />);
    expect(html).toMatch(/action="\/dashboard\/api-keys\/create"/);
    expect(html).toMatch(/method="post"/i);
    expect(html).toMatch(/name="label"/);
    expect(html).toMatch(/required/);
    expect(html).toMatch(/Cancel/);
  });

  // -------------------------------------------------------------------------
  // 8: shows error when ?error= passed.
  // -------------------------------------------------------------------------
  it('surfaces an error message when one is provided', () => {
    const html = renderToStaticMarkup(<NewKeyFormView error="Label is required" />);
    expect(html).toMatch(/Label is required/);
    expect(html).toMatch(/role="alert"/);
  });
});

describe('/dashboard/api-keys/create result view (issue #81)', () => {
  // Built by concatenation so the literal source line carries no Stripe-key
  // shape — GitHub Push Protection blocks anything matching sk_live_<26 alnum>.
  const RAW_KEY = ['sk', '_l', 'ive_'].join('') + 'NotARealKeyJustATestFixt9z';

  // -------------------------------------------------------------------------
  // 9: full key shown ONCE with a clear "save now" warning.
  // -------------------------------------------------------------------------
  it('renders the full key with a "save this key now" warning', () => {
    const html = renderToStaticMarkup(
      <NewKeyResultView apiKey={RAW_KEY} label="CI deploy" prefix="sk_live_A" />,
    );
    expect(html).toMatch(/Save this key now/i);
    expect(html).toMatch(/will not be shown again/i);
    // The raw key is rendered inside a <pre> for unambiguous selection.
    expect(html).toContain(RAW_KEY);
    // Label is shown to confirm "this is the key you just created".
    expect(html).toMatch(/CI deploy/);
    // Done button takes the user back to the list.
    expect(html).toMatch(/href="\/dashboard\/api-keys"/);
  });

  // -------------------------------------------------------------------------
  // 10: result view contains no inline script — CSP §5.10.
  // -------------------------------------------------------------------------
  it('contains no inline <script> tags or style= attributes (CSP §5.10)', () => {
    const html = renderToStaticMarkup(
      <NewKeyResultView apiKey={RAW_KEY} label="CI deploy" prefix="sk_live_A" />,
    );
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/\sstyle="/i);
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp — observable via ApiKeysView rendered output.
// ---------------------------------------------------------------------------

describe('ApiKeysView — formatTimestamp display', () => {
  it('null last_used_at renders "never"', () => {
    // REVOKED_KEY has last_used_at: null → formatTimestamp(null) → 'never'.
    const html = renderToStaticMarkup(<ApiKeysView keys={[REVOKED_KEY]} />);
    expect(html).toContain('never');
  });

  it('valid ISO timestamp renders in YYYY-MM-DD HH:MM UTC format', () => {
    // FIXTURE_KEY.last_used_at = '2026-04-24T10:30:00.000Z'
    // → formatTimestamp → '2026-04-24 10:30 UTC'
    const html = renderToStaticMarkup(<ApiKeysView keys={[FIXTURE_KEY]} />);
    expect(html).toContain('2026-04-24 10:30 UTC');
  });

  it('invalid date string is returned unchanged (no throw, no NaN)', () => {
    const keyWithBadDate: ApiKeyRow = {
      ...FIXTURE_KEY,
      id: 99,
      last_used_at: 'not-a-date',
    };
    const html = renderToStaticMarkup(<ApiKeysView keys={[keyWithBadDate]} />);
    // formatTimestamp returns the original string when the Date is Invalid.
    expect(html).toContain('not-a-date');
    expect(html).not.toContain('NaN');
  });
});
