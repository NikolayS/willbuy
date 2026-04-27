/**
 * verdict-copy.test.tsx — spec-pin for VERDICT_COPY in HeadlineDelta.tsx.
 *
 * Spec §5.18 #1: the verdict sentence rendered in the headline must match
 * the aggregator's output. Changing the copy breaks the user-facing
 * interpretation of A/B test results.
 *
 * - 'better'      → 'NEW converts better.'
 * - 'worse'       → 'NEW converts worse.'
 * - 'inconclusive' → 'Inconclusive — no clear winner.'
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeadlineDelta } from '../components/report/HeadlineDelta';

function makeHeadline(verdict: 'better' | 'worse' | 'inconclusive') {
  return {
    mean_delta: 0.5,
    ci95_low: 0.1,
    ci95_high: 0.9,
    n_paired: 20,
    paired_t_p: 0.02,
    wilcoxon_p: 0.03,
    mcnemar_p: 0.04,
    verdict,
    disagreement: false,
  };
}

describe('VERDICT_COPY spec-pin (spec §5.18 #1)', () => {
  it('"better" verdict renders "NEW converts better."', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline('better')} />,
    );
    expect(html).toContain('NEW converts better.');
  });

  it('"worse" verdict renders "NEW converts worse."', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline('worse')} />,
    );
    expect(html).toContain('NEW converts worse.');
  });

  it('"inconclusive" verdict renders "Inconclusive — no clear winner."', () => {
    const html = renderToStaticMarkup(
      <HeadlineDelta headline={makeHeadline('inconclusive')} />,
    );
    expect(html).toContain('Inconclusive — no clear winner.');
  });
});
