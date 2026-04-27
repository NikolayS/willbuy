/**
 * api-keys-new-page.test.tsx — tests for /dashboard/api-keys/new.
 *
 * This is a server component that:
 *   - Redirects to /sign-in when no session cookie present
 *   - Renders NewKeyFormView without error when no error param
 *   - Renders NewKeyFormView with error message when ?error= is set
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

describe('NewApiKeyPage', () => {
  it('redirects to /sign-in when no session cookie', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies([]));
    const { default: Page } = await import('../app/dashboard/api-keys/new/page');
    expect(() => Page({ searchParams: {} })).toThrow('NEXT_REDIRECT');
    expect(redirectTargets[0]).toMatch(/sign-in/);
  });

  it('renders the form when session cookie is present and no error', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies(['wb_session']));
    const { default: Page } = await import('../app/dashboard/api-keys/new/page');
    const el = Page({ searchParams: {} });
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/label/i);
    expect(html).not.toMatch(/error/i);
  });

  it('renders error message when ?error= is set', async () => {
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockReturnValue(makeCookies(['wb_session']));
    const { default: Page } = await import('../app/dashboard/api-keys/new/page');
    const el = Page({ searchParams: { error: 'Label is required' } });
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/Label is required/);
  });
});
