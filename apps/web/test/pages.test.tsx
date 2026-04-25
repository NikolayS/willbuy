import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingPage from '../app/page';
import DashboardPage from '../app/dashboard/page';
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

describe('dashboard placeholder — GET /dashboard', () => {
  it('renders "Sign in coming soon"', () => {
    const html = renderToStaticMarkup(<DashboardPage />);
    expect(html).toMatch(/sign in coming soon/i);
  });
});

describe('public report — GET /r/[slug]', () => {
  it('renders a "not found" body when no report exists for the slug', async () => {
    delete process.env.WILLBUY_REPORT_FIXTURE;
    const el = await ReportPage({ params: Promise.resolve({ slug: 'no-such-slug' }) });
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/report not found/i);
  });

  it('renders the report when the fixture seam is enabled and the slug matches', async () => {
    process.env.WILLBUY_REPORT_FIXTURE = 'enabled';
    try {
      const el = await ReportPage({ params: Promise.resolve({ slug: 'test-fixture' }) });
      const html = renderToStaticMarkup(el);
      // Element 1 — headline delta — uses the verdict copy from the fixture.
      expect(html).toMatch(/converts better/i);
      // Slug rendered as <code> per §5.10.
      expect(html).toMatch(/<code[^>]*>test-fixture<\/code>/);
    } finally {
      delete process.env.WILLBUY_REPORT_FIXTURE;
    }
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
