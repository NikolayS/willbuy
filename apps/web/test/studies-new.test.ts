// @vitest-environment jsdom
//
// TDD acceptance tests for issue #34:
//   - study creation form (apps/web/app/dashboard/studies/new/page.tsx)
//   - status page (apps/web/app/dashboard/studies/[id]/page.tsx)
//   - api-client (apps/web/lib/api-client.ts)
//
// Spec refs: §2 #1 (verified-domain), §2 #18 (paired A/B = exactly 2 URLs),
//            §4.1 (web app), §3 (user stories Mira/Kenji/Dana/dogfood).
// SPEC §5.10: no inline scripts; Tailwind + server-side CSP from middleware.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── Stubs for Next.js router (App Router) ────────────────────────────────────
// The form calls router.push() on success. We stub the module so the
// component can be rendered outside a Next.js runtime.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// ── Module under test ─────────────────────────────────────────────────────────
// Imported lazily inside each test group so mock can be applied first.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Form renders with 1 URL field by default; clicking "+ add second" → 2
// ─────────────────────────────────────────────────────────────────────────────
describe('StudyNewPage — URL inputs', () => {
  it('renders a single URL input by default', async () => {
    const { default: StudyNewPage } = await import(
      '../app/dashboard/studies/new/page'
    );
    render(React.createElement(StudyNewPage));
    // Should find exactly one URL field by label or placeholder.
    const urlInputs = screen.getAllByRole('textbox', { name: /url/i });
    expect(urlInputs.length).toBe(1);
  });

  it('clicking "+ add second URL for paired A/B" reveals a second URL input', async () => {
    const { default: StudyNewPage } = await import(
      '../app/dashboard/studies/new/page'
    );
    render(React.createElement(StudyNewPage));
    const addBtn = screen.getByRole('button', { name: /add second/i });
    fireEvent.click(addBtn);
    const urlInputs = screen.getAllByRole('textbox', { name: /url/i });
    expect(urlInputs.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Submit with empty URLs → form-level error; no API call
// ─────────────────────────────────────────────────────────────────────────────
describe('StudyNewPage — empty-URL validation', () => {
  it('shows a form-level error when submitting with no URL; does NOT call fetch', async () => {
    const { default: StudyNewPage } = await import(
      '../app/dashboard/studies/new/page'
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(React.createElement(StudyNewPage));
    const submitBtn = screen.getByRole('button', { name: /start study/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    // Client-side validation fires; no fetch call made.
    expect(fetchSpy).not.toHaveBeenCalled();
    // Error message visible.
    expect(screen.getByText(/url.*required|enter.*url|url.*empty/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Submit with valid URL + ICP + N → POST with correct body shape
// ─────────────────────────────────────────────────────────────────────────────
describe('StudyNewPage — successful submission body shape', () => {
  it('POSTs urls, icp, n_visits to /studies on valid submit', async () => {
    const { default: StudyNewPage } = await import(
      '../app/dashboard/studies/new/page'
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ study_id: 42, status: 'capturing' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(React.createElement(StudyNewPage));

    // Fill URL
    const [urlInput] = screen.getAllByRole('textbox', { name: /url/i });
    fireEvent.change(urlInput!, { target: { value: 'https://example.com/pricing' } });

    // The form should pre-select an ICP; just submit with defaults.
    const submitBtn = screen.getByRole('button', { name: /start study/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [url, opts] = fetchSpy.mock.calls[0]!;
    // Must POST to /studies (relative or absolute).
    expect(String(url)).toMatch(/\/studies$/);
    expect((opts as RequestInit).method).toBe('POST');

    const body = JSON.parse((opts as RequestInit).body as string) as unknown;
    expect(body).toMatchObject({
      urls: ['https://example.com/pricing'],
      icp: expect.objectContaining({ preset_id: expect.any(String) }),
      n_visits: expect.any(Number),
    });
    // n_visits must be between 5 and 100 (spec §2 #12, default 30).
    expect((body as { n_visits: number }).n_visits).toBeGreaterThanOrEqual(5);
    expect((body as { n_visits: number }).n_visits).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. API returns 422 (unverified domain) → error rendered inline
// ─────────────────────────────────────────────────────────────────────────────
describe('StudyNewPage — 422 unverified domain error', () => {
  it('shows the unverified-domain message with a Verify domain link', async () => {
    const { default: StudyNewPage } = await import(
      '../app/dashboard/studies/new/page'
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'unverified domain: example.com' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(React.createElement(StudyNewPage));

    const [urlInput] = screen.getAllByRole('textbox', { name: /url/i });
    fireEvent.change(urlInput!, { target: { value: 'https://example.com/pricing' } });

    const submitBtn = screen.getByRole('button', { name: /start study/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Must show unverified-domain message.
    await waitFor(() =>
      expect(screen.getByText(/not verified|unverified domain/i)).toBeTruthy(),
    );
    // Must provide a "Verify domain" link (Sprint 3 placeholder is fine).
    const verifyLink = screen.getByRole('link', { name: /verify domain/i });
    expect(verifyLink).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. API returns 402 (cap exceeded) → friendly message + top-up link
// ─────────────────────────────────────────────────────────────────────────────
describe('StudyNewPage — 402 cap exceeded error', () => {
  it('shows the "out of credits" message with a Buy credits link', async () => {
    const { default: StudyNewPage } = await import(
      '../app/dashboard/studies/new/page'
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'daily spend cap exceeded' }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(React.createElement(StudyNewPage));

    const [urlInput] = screen.getAllByRole('textbox', { name: /url/i });
    fireEvent.change(urlInput!, { target: { value: 'https://example.com/pricing' } });

    const submitBtn = screen.getByRole('button', { name: /start study/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() =>
      expect(screen.getByText(/out of credits|credits.*exceeded|spend cap/i)).toBeTruthy(),
    );
    // Buy credits link required.
    const buyLink = screen.getByRole('link', { name: /buy credits/i });
    expect(buyLink).toBeTruthy();
    // Link must point somewhere related to credits.
    expect(buyLink.getAttribute('href')).toMatch(/credit/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Status page polls /studies/:id every 5 s; UI reflects status changes
// ─────────────────────────────────────────────────────────────────────────────
describe('StudyStatusPage — polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls GET /studies/:id every 5 s and updates status in the UI', async () => {
    // First call: status=visiting; second call: status=ready.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 7,
            status: 'visiting',
            visit_progress: { ok: 10, failed: 0, total: 30 },
            started_at: new Date().toISOString(),
            finalized_at: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 7,
            status: 'ready',
            visit_progress: { ok: 30, failed: 0, total: 30 },
            started_at: new Date().toISOString(),
            finalized_at: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const { default: StudyStatusPage } = await import(
      '../app/dashboard/studies/[id]/page'
    );

    // Render with params promise (Next.js 14 App Router async params)
    await act(async () => {
      render(
        React.createElement(StudyStatusPage, {
          params: Promise.resolve({ id: '7' }),
        }),
      );
    });

    // First fetch fires on mount; wait for 'visiting' to show.
    await waitFor(() =>
      expect(screen.getByText(/visiting/i)).toBeTruthy(),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance 5 s → second poll fires.
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    // Status should now show 'ready'.
    await waitFor(() =>
      expect(screen.getByText(/ready/i)).toBeTruthy(),
    );

    // When ready, a link to /r/<slug> must appear.
    // The API returns study_id=7 but no slug; the status page should at
    // minimum link to the report. We check for a link matching /r/ or
    // /report or similar.
    const reportLink = screen.queryByRole('link', { name: /view report|see report|report/i });
    expect(reportLink).toBeTruthy();
  });

  it('advances timer past 5 s per poll interval; does NOT poll before 5 s', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 99,
          status: 'capturing',
          visit_progress: { ok: 0, failed: 0, total: 30 },
          started_at: new Date().toISOString(),
          finalized_at: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { default: StudyStatusPage } = await import(
      '../app/dashboard/studies/[id]/page'
    );

    await act(async () => {
      render(
        React.createElement(StudyStatusPage, {
          params: Promise.resolve({ id: '99' }),
        }),
      );
    });

    // Allow mount fetch to resolve.
    await waitFor(() => expect(screen.getByText(/capturing/i)).toBeTruthy());
    const callCount = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    // Advance only 4 s — no new poll yet.
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);

    // Advance 1 more s (total 5 s) → poll fires.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await waitFor(() =>
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callCount),
    );
  });
});
