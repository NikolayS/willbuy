/**
 * report-color-constants.test.ts — spec-pins for color constants used in
 * report visualisations.
 *
 * SWING_COLOR (PairedDots.tsx): the three swing directions map to specific
 * hex values that convey meaning (red=A wins, green=B wins, gray=tie).
 * Changing b_wins from #16a34a would silently break visual consistency with
 * VARIANT_COLOR['B'] in Histograms.tsx, which uses the same green.
 *
 * VARIANT_COLOR (Histograms.tsx): A→slate, B→green (same green as b_wins
 * in SWING_COLOR). Cross-component color identity is intentional per spec
 * §5.18 — these two pins together catch a drift between the two files.
 *
 * STORAGE_KEY (ReportCtaBar.tsx): localStorage key used to persist dismissal.
 * A rename silently breaks existing dismissed state for all current users.
 */

import { describe, expect, it } from 'vitest';
import { __test__ as pairedDotsTest } from '../components/report/PairedDots';
import { __test__ as histogramsTest } from '../components/report/Histograms';
import { __test__ as ctaBarTest } from '../components/report/ReportCtaBar';

const { SWING_COLOR } = pairedDotsTest;
const { VARIANT_COLOR } = histogramsTest;
const { STORAGE_KEY } = ctaBarTest;

describe('SWING_COLOR spec-pin (PairedDots — swing direction colours)', () => {
  it('has exactly 3 entries', () => {
    expect(Object.keys(SWING_COLOR)).toHaveLength(3);
  });

  it('"a_wins" is red (#dc2626)', () => {
    expect(SWING_COLOR['a_wins']).toBe('#dc2626');
  });

  it('"tie" is gray (#9ca3af)', () => {
    expect(SWING_COLOR['tie']).toBe('#9ca3af');
  });

  it('"b_wins" is green (#16a34a) — matches VARIANT_COLOR["B"]', () => {
    expect(SWING_COLOR['b_wins']).toBe('#16a34a');
  });
});

describe('VARIANT_COLOR spec-pin (Histograms — per-variant bar colours)', () => {
  it('has exactly 2 entries', () => {
    expect(Object.keys(VARIANT_COLOR)).toHaveLength(2);
  });

  it('"A" is slate (#475569)', () => {
    expect(VARIANT_COLOR['A']).toBe('#475569');
  });

  it('"B" is green (#16a34a) — matches SWING_COLOR["b_wins"]', () => {
    expect(VARIANT_COLOR['B']).toBe('#16a34a');
  });
});

describe('cross-component color consistency', () => {
  it('SWING_COLOR["b_wins"] === VARIANT_COLOR["B"] (visual identity)', () => {
    expect(SWING_COLOR['b_wins']).toBe(VARIANT_COLOR['B']);
  });
});

describe('STORAGE_KEY spec-pin (ReportCtaBar — localStorage dismiss key)', () => {
  it('is the exact key used to persist dismissal', () => {
    expect(STORAGE_KEY).toBe('willbuy_report_cta_dismissed');
  });
});
