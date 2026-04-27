// @vitest-environment jsdom
//
// Unit tests for HeadlineDelta (components/report/HeadlineDelta.tsx).
//
// The component is tested indirectly via report-viz.test.tsx (which only
// verifies the testid is present). This file isolates the key rendering
// behaviors:
//   - All three verdicts render their correct copy
//   - Mean delta rendered with sign (+/-) and 2 decimal places
//   - Stat values (p-values, N paired, CI) rendered
//   - CSP §5.10: no inline scripts or style= attributes

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { HeadlineDelta } from '../components/report/HeadlineDelta';
import type { ReportT } from '../components/report/types';

type Headline = ReportT['headline'];

function makeHeadline(overrides: Partial<Headline>): Headline {
  return {
    mean_delta: 1.5,
    ci95_low: 0.3,
    ci95_high: 2.7,
    n_paired: 30,
    paired_t_p: 0.02,
    wilcoxon_p: 0.03,
    mcnemar_p: 0.04,
    verdict: 'better',
    disagreement: false,
    ...overrides,
  };
}

describe('HeadlineDelta', () => {
  it('renders "NEW converts better." for verdict=better', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline({ verdict: 'better' })} />,
    );
    expect(html).toMatch(/converts better/i);
  });

  it('renders "NEW converts worse." for verdict=worse', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline({ verdict: 'worse' })} />,
    );
    expect(html).toMatch(/converts worse/i);
  });

  it('renders "Inconclusive" for verdict=inconclusive', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline({ verdict: 'inconclusive' })} />,
    );
    expect(html).toMatch(/inconclusive/i);
  });

  it('renders "+" prefix for positive mean_delta', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline({ mean_delta: 1.5 })} />,
    );
    expect(html).toContain('+1.50');
  });

  it('renders no prefix for negative mean_delta (minus is part of the number)', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline({ mean_delta: -1.5 })} />,
    );
    expect(html).toContain('-1.50');
    expect(html).not.toMatch(/\+-1/);
  });

  it('renders N paired value', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline({ n_paired: 42 })} />,
    );
    expect(html).toContain('42');
  });

  it('renders paired-t, Wilcoxon, McNemar p-values', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline({ paired_t_p: 0.015, wilcoxon_p: 0.03, mcnemar_p: 0.04 })} />,
    );
    expect(html).toMatch(/0\.015/);
    expect(html).toMatch(/0\.030/);
    expect(html).toMatch(/0\.040/);
  });

  it('renders "p < 0.001" for very small p-values', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline({ paired_t_p: 0.0001 })} />,
    );
    expect(html).toContain('p &lt; 0.001');
  });

  it('contains no inline <script> tags or style= attributes (CSP §5.10)', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline({})} />,
    );
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/style="/i);
  });
});
