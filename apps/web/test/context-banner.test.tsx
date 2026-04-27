// @vitest-environment jsdom
//
// Tests for ContextBanner — three rendering states:
//   1. Empty urls array → renders nothing
//   2. Single URL → "Page tested: <url>" with link
//   3. Paired A/B URLs → "A: <url-a> vs B: <url-b>" with both links

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ContextBanner } from '../components/report/ContextBanner';

describe('ContextBanner', () => {
  it('renders nothing for empty urls array', () => {
    const html = renderToStaticMarkup(<ContextBanner urls={[]} />);
    expect(html).toBe('');
  });

  it('single URL: renders "Page tested" label and link to the URL', () => {
    const url = 'https://example.com/pricing';
    const html = renderToStaticMarkup(<ContextBanner urls={[url]} />);
    expect(html).toMatch(/page tested/i);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(url);
    // Must NOT render "vs" or A/B labels.
    expect(html).not.toMatch(/\bvs\b/i);
    expect(html).not.toMatch(/font-semibold.*A:/);
  });

  it('paired URLs: renders A label, B label, "vs" separator, and both links', () => {
    const urlA = 'https://example.com/pricing-v1';
    const urlB = 'https://example.com/pricing-v2';
    const html = renderToStaticMarkup(<ContextBanner urls={[urlA, urlB]} />);
    // Both URLs must appear as link hrefs.
    expect(html).toContain(`href="${urlA}"`);
    expect(html).toContain(`href="${urlB}"`);
    // A and B labels.
    expect(html).toMatch(/A:/);
    expect(html).toMatch(/B:/);
    // Separator.
    expect(html).toMatch(/vs/i);
  });

  it('links use target=_blank + rel=noopener noreferrer', () => {
    const url = 'https://example.com/page';
    const html = renderToStaticMarkup(<ContextBanner urls={[url]} />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
