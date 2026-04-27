/**
 * dashboard-page.test.tsx — server-component error states for /dashboard.
 *
 * DashboardView (the presentational layer) is tested in dashboard.test.tsx.
 * This file tests the DashboardPage server component's branching logic:
 *   - No session cookie → redirect to /sign-in
 *   - API returns 401 → redirect to /sign-in
 *   - API returns 5xx (network error) → "Dashboard unavailable" message
 *   - API returns 200 → renders DashboardView (happy path)
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Stub next/headers so cookies() can be controlled per test.
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

// Stub next/navigation — redirect() throws a Next.js internal error in tests;
// capture the target URL instead.
const redirectTargets: string[] = [];
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    redirectTargets.push(url);
    // Simulate Next.js redirect by throwing (same mechanism as the real impl).
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

afterEach(() => {
  redirectTargets.length = 0;
  vi.clearAllMocks();
});

function makeCookies(names: string[]) {
  return {
    getAll: () => names.map((name) => ({ name, value: 'test-value' })),
  };
}

const FIXTURE_SUMMARY = {
  email: 'test@example.com',
  balance_cents: 2900,
  recent_studies: [],
};

describe('DashboardPage — server component error states', () => {
  it('redirects to /sign-in when no session cookie is present', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies([]));

    const { default: DashboardPage } = await import('../app/dashboard/page');
    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(redirectTargets).toContain('/sign-in');
  });

  it('redirects to /sign-in when API returns 401', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(
      makeCookies(['wb_session']),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );

    const { default: DashboardPage } = await import('../app/dashboard/page');
    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(redirectTargets).toContain('/sign-in');
  });

  it('renders "Dashboard unavailable" on network / 5xx error', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(
      makeCookies(['wb_session']),
    );
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const { default: DashboardPage } = await import('../app/dashboard/page');
    const el = await DashboardPage();
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/dashboard unavailable/i);
  });

  it('renders DashboardView on successful 200 response', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(
      makeCookies(['wb_session']),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_SUMMARY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { default: DashboardPage } = await import('../app/dashboard/page');
    const el = await DashboardPage();
    const html = renderToStaticMarkup(el);
    // DashboardView renders the email and balance.
    expect(html).toMatch(/test@example\.com/);
    expect(html).toMatch(/\$29\.00|\$29/);
  });
});
