import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingPage from '../app/page';
import ReportPage, { metadata as reportMetadata } from '../app/r/[slug]/page';

describe('marketing landing — GET /', () => {
  it('renders the "synthetic visitor panel" copy', () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toMatch(/synthetic visitor panel/i);
  });

  it('renders an H1', () => {
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).toMatch(/<h1[\s>]/);
  });
});

// Dashboard rendering is covered by apps/web/test/dashboard.test.tsx (issue #80).
// The pre-#80 placeholder ("Sign in coming soon") was retired when the real
// server-component dashboard landed.

describe('public report — GET /r/[slug]', () => {
  it('renders a "not found" body when no report exists for the slug', async () => {
    const el = await ReportPage({ params: Promise.resolve({ slug: 'no-such-slug' }) });
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/report not found/i);
  });

  it('renders the report for the public demo slug (test-fixture)', async () => {
    const el = await ReportPage({ params: Promise.resolve({ slug: 'test-fixture' }) });
    const html = renderToStaticMarkup(el);
    // Element 1 — headline delta — uses the verdict copy from the fixture.
    expect(html).toMatch(/converts better/i);
    // Slug rendered as <code> per §5.10.
    expect(html).toMatch(/<code[^>]*>test-fixture<\/code>/);
  });

  it('renders "being prepared" when the API returns report_json: null (pending state)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ report_json: null, urls: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const el = await ReportPage({ params: Promise.resolve({ slug: 'pending-slug' }) });
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/being prepared/i);
    vi.restoreAllMocks();
  });

  it('exports metadata with noindex (per SPEC §5.10 untrusted-content boundary)', () => {
    expect(reportMetadata.robots).toBeDefined();
    // Next.js accepts either a string "noindex" or { index: false }.
    const robots = reportMetadata.robots;
    const isNoindex =
      robots === 'noindex' ||
      (typeof robots === 'object' && robots !== null && (robots as { index?: boolean }).index === false);
    expect(isNoindex).toBe(true);
  });
});
