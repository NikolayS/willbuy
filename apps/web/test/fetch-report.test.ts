/**
 * fetch-report.test.ts — unit tests for fetchReport() (app/r/[slug]/fetchReport.ts).
 *
 * fetchReport is tested indirectly through ReportPage in pages.test.tsx, but
 * those tests only cover the test-fixture, network-error, and pending paths.
 * This file directly tests the return-value contract to document all branches:
 *
 *   slug === 'test-fixture'   → ReportPayload (uses static import, no fetch)
 *   fetch throws              → 'not_found'
 *   404 from API              → 'not_found'
 *   non-2xx non-404           → 'not_found'
 *   200 + report_json = null  → 'pending'
 *   200 + report_json present → ReportPayload with reportJson + urls
 *   wb_rt_<slug> cookie       → forwarded to API as Cookie header
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// next/headers is a server-only module; stub cookies() to avoid runtime errors.
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchReport()', () => {
  it('returns a ReportPayload for the "test-fixture" slug without hitting the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { fetchReport } = await import('../app/r/[slug]/fetchReport');
    const result = await fetchReport('test-fixture');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(typeof result).toBe('object');
    expect(result).not.toBe('not_found');
    expect(result).not.toBe('pending');
    expect((result as { reportJson: unknown }).reportJson).toBeTruthy();
  });

  it('returns "not_found" when fetch throws (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { fetchReport } = await import('../app/r/[slug]/fetchReport');
    const result = await fetchReport('any-slug');
    expect(result).toBe('not_found');
  });

  it('returns "not_found" when API returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 404 }),
    );
    const { fetchReport } = await import('../app/r/[slug]/fetchReport');
    const result = await fetchReport('unknown-slug');
    expect(result).toBe('not_found');
  });

  it('returns "not_found" when API returns a non-2xx non-404 status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 500 }),
    );
    const { fetchReport } = await import('../app/r/[slug]/fetchReport');
    const result = await fetchReport('error-slug');
    expect(result).toBe('not_found');
  });

  it('returns "pending" when API returns 200 with report_json: null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ report_json: null, urls: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { fetchReport } = await import('../app/r/[slug]/fetchReport');
    const result = await fetchReport('pending-slug');
    expect(result).toBe('pending');
  });

  it('returns ReportPayload with reportJson and urls when API returns 200', async () => {
    const reportJson = { meta: { slug: 'test' } };
    const urls = ['https://example.com/pricing'];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ report_json: reportJson, urls }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { fetchReport } = await import('../app/r/[slug]/fetchReport');
    const result = await fetchReport('my-slug');
    expect(result).not.toBe('not_found');
    expect(result).not.toBe('pending');
    expect((result as { reportJson: unknown }).reportJson).toEqual(reportJson);
    expect((result as { urls: string[] | null }).urls).toEqual(urls);
  });

  it('forwards the wb_rt_<slug> cookie to the API when present', async () => {
    // Set up the cookie mock to return a token for this slug.
    const { cookies } = await import('next/headers');
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      get: (name: string) =>
        name === 'wb_rt_cookie-slug' ? { name, value: 'share-token-xyz' } : undefined,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ report_json: { meta: { slug: 'x' } }, urls: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { fetchReport } = await import('../app/r/[slug]/fetchReport');
    await fetchReport('cookie-slug');

    expect(fetchSpy).toHaveBeenCalled();
    const [, opts] = fetchSpy.mock.calls[0]!;
    const cookieHeader = (opts as RequestInit & { headers?: Record<string, string> }).headers?.['cookie'];
    expect(cookieHeader).toContain('wb_rt_cookie-slug=share-token-xyz');
  });
});
