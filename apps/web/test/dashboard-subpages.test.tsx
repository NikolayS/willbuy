/**
 * dashboard-subpages.test.tsx — 401 + network error branches for the three
 * remaining dashboard server components: api-keys, credits, domains.
 *
 * Each follows the same pattern as DashboardPage and StudiesListPage:
 *   no session → redirect(/sign-in)
 *   API 401    → redirect(/sign-in)
 *   network err → "{page} unavailable" message
 *
 * The happy-path rendering is covered by the existing presentation-layer
 * tests (api-keys.test.tsx, domains-list.test.tsx, buy-credits.test.tsx).
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

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
  return { getAll: () => names.map((n) => ({ name: n, value: 'v' })) };
}

// ── /dashboard/api-keys ───────────────────────────────────────────────────────
describe('ApiKeysPage — server component error states', () => {
  it('redirects to /sign-in when no session cookie present', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies([]));
    const { default: Page } = await import('../app/dashboard/api-keys/page');
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectTargets[0]).toMatch(/sign-in/);
  });

  it('redirects to /sign-in on 401', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies(['wb_session']));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { default: Page } = await import('../app/dashboard/api-keys/page');
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectTargets[0]).toMatch(/sign-in/);
  });

  it('renders "API keys unavailable" on network error', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies(['wb_session']));
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { default: Page } = await import('../app/dashboard/api-keys/page');
    const html = renderToStaticMarkup(await Page());
    expect(html).toMatch(/api keys unavailable/i);
  });
});

// ── /dashboard/domains ────────────────────────────────────────────────────────
describe('DomainsListPage — server component error states', () => {
  it('redirects to /sign-in when no session cookie present', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies([]));
    const { default: Page } = await import('../app/dashboard/domains/page');
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectTargets[0]).toMatch(/sign-in/);
  });

  it('redirects to /sign-in on 401', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies(['wb_session']));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { default: Page } = await import('../app/dashboard/domains/page');
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectTargets[0]).toMatch(/sign-in/);
  });

  it('renders "Domains unavailable" on network error', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies(['wb_session']));
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { default: Page } = await import('../app/dashboard/domains/page');
    const html = renderToStaticMarkup(await Page());
    expect(html).toMatch(/domains unavailable/i);
  });
});

// ── /dashboard/credits ────────────────────────────────────────────────────────
// Credits page uses `await cookies()` (async) + `.get()` — different API than
// the other pages which use sync `cookies()` + `getAll()`.
function makeCreditsCookies(includeSession: boolean) {
  const cookie = includeSession ? { name: 'wb_session', value: 'test' } : null;
  return {
    get: (name: string) => (name === 'wb_session' && cookie ? cookie : undefined),
    getAll: () => (cookie ? [cookie] : []),
  };
}

describe('CreditsPage — server component error states', () => {
  it('redirects to /sign-in when no session cookie present', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(makeCreditsCookies(false));
    const { default: Page } = await import('../app/dashboard/credits/page');
    await expect(
      Page({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectTargets[0]).toMatch(/sign-in/);
  });

  it('redirects to /sign-in on 401', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(makeCreditsCookies(true));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { default: Page } = await import('../app/dashboard/credits/page');
    await expect(
      Page({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectTargets[0]).toMatch(/sign-in/);
  });
});
