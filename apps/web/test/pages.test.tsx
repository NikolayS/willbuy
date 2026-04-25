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

describe('public report placeholder — GET /r/[slug]', () => {
  it('renders the placeholder body', async () => {
    const el = await ReportPage({ params: Promise.resolve({ slug: 'abc' }) });
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/public report — pending implementation/i);
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
