// @vitest-environment jsdom
//
// Unit tests for DisagreementBanner (components/report/DisagreementBanner.tsx).
//
// The component is exercised in report-viz.test.tsx via the disagreement
// fixture, but only through a full ReportView render. These tests isolate
// the component to verify:
//   - Returns null when headline.disagreement is false
//   - Renders the banner when headline.disagreement is true
//   - Shows "tests disagree" copy
//   - Shows the conservative (larger) p-value
//   - Uses the correct role="alert"
//
// Spec §2 #19.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { DisagreementBanner } from '../components/report/DisagreementBanner';
import type { ReportT } from '../components/report/types';

type Headline = ReportT['headline'];

function makeHeadline(overrides: Partial<Headline>): Headline {
  return {
    mean_delta: 0.3,
    ci95_low: -0.1,
    ci95_high: 0.7,
    n_paired: 20,
    paired_t_p: 0.663,
    wilcoxon_p: 0.012,
    mcnemar_p: 0.1,
    verdict: 'inconclusive',
    disagreement: false,
    ...overrides,
  };
}

describe('DisagreementBanner', () => {
  it('renders nothing when disagreement is false', () => {
    const html = renderToStaticMarkup(
      <DisagreementBanner headline={makeHeadline({ disagreement: false })} />,
    );
    expect(html).toBe('');
  });

  it('renders the banner when disagreement is true', () => {
    const html = renderToStaticMarkup(
      <DisagreementBanner
        headline={makeHeadline({ disagreement: true, paired_t_p: 0.663, wilcoxon_p: 0.012 })}
      />,
    );
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('data-testid="disagreement-banner"');
  });

  it('copy labels the conclusion as "weak" and "tests disagree"', () => {
    const html = renderToStaticMarkup(
      <DisagreementBanner
        headline={makeHeadline({ disagreement: true })}
      />,
    );
    expect(html).toMatch(/weak/i);
    expect(html).toMatch(/tests disagree/i);
  });

  it('shows the conservative (larger) p-value — paired_t_p wins when larger', () => {
    const html = renderToStaticMarkup(
      <DisagreementBanner
        headline={makeHeadline({ disagreement: true, paired_t_p: 0.663, wilcoxon_p: 0.012 })}
      />,
    );
    // Conservative p = max(0.663, 0.012) = 0.663
    expect(html).toContain('0.663');
    expect(html).not.toContain('0.012');
  });

  it('shows the conservative (larger) p-value — wilcoxon_p wins when larger', () => {
    const html = renderToStaticMarkup(
      <DisagreementBanner
        headline={makeHeadline({ disagreement: true, paired_t_p: 0.04, wilcoxon_p: 0.092 })}
      />,
    );
    // Conservative p = max(0.04, 0.092) = 0.092
    expect(html).toContain('0.092');
  });

  it('has role="alert" for accessibility', () => {
    const html = renderToStaticMarkup(
      <DisagreementBanner headline={makeHeadline({ disagreement: true })} />,
    );
    expect(html).toContain('role="alert"');
  });
});
