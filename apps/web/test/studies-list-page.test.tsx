/**
 * studies-list-page.test.tsx — server-component error states for /dashboard/studies.
 *
 * StudiesListView (the presentational layer) is tested in studies-list.test.tsx.
 * This file tests the StudiesListPage server component's branching logic:
 *   - No session cookie → redirect to /sign-in?redirect=%2Fdashboard%2Fstudies
 *   - API returns 401 → redirect to /sign-in?redirect=%2Fdashboard%2Fstudies
 *   - API returns 5xx / network error → "Studies unavailable" message
 *   - API returns 200 → renders StudiesListView (happy path)
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

const redirectTargets: string[] = [];
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    redirectTargets.push(url);
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

const EMPTY_LIST = { studies: [], next_cursor: null };

describe('StudiesListPage — server component error states', () => {
  it('redirects to /sign-in when no session cookie is present', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies([]));

    const { default: StudiesListPage } = await import('../app/dashboard/studies/page');
    await expect(StudiesListPage({})).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectTargets[0]).toMatch(/sign-in/);
  });

  it('redirects to /sign-in when API returns 401', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(
      makeCookies(['wb_session']),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 401 }),
    );

    const { default: StudiesListPage } = await import('../app/dashboard/studies/page');
    await expect(StudiesListPage({})).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectTargets[0]).toMatch(/sign-in/);
  });

  it('renders "Studies unavailable" on network error', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(
      makeCookies(['wb_session']),
    );
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { default: StudiesListPage } = await import('../app/dashboard/studies/page');
    const el = await StudiesListPage({});
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/studies unavailable/i);
  });

  it('renders StudiesListView on 200 response', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(
      makeCookies(['wb_session']),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(EMPTY_LIST), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { default: StudiesListPage } = await import('../app/dashboard/studies/page');
    const el = await StudiesListPage({});
    const html = renderToStaticMarkup(el);
    // StudiesListView renders an empty-state message when there are no studies.
    expect(html).toMatch(/no studies yet|start one|new study/i);
  });
});
