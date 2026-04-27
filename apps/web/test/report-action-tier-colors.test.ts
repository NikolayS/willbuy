/**
 * report-action-tier-colors.test.ts — spec-pins for ACTION_COLOR, TIER_COLOR,
 * and VARIANT_COLORS in the next-actions and tier-picked visualisations.
 *
 * ACTION_COLOR (NextActions.tsx): 8 entries covering the full NextActionT union.
 * The color gradient (green → red) encodes intent weight — leave is always
 * red (#dc2626), purchase_paid_today is always dark green (#15803d).
 * A swap silently misrepresents intent in the stacked bar and Sankey.
 *
 * TIER_COLOR (TierPicked.tsx): 6 entries covering the full Tier union.
 * Uses the same green scale as ACTION_COLOR (enterprise=#15803d, none=#dc2626)
 * for visual consistency across the report page.
 *
 * VARIANT_COLORS (NextActions.tsx): 5-entry palette for Sankey variant nodes.
 * Pins both the length (guards against accidental truncation) and the first
 * entry (indigo — the brand's primary colour for the A variant).
 */

import { describe, expect, it } from 'vitest';
import { __test__ as nextActionsTest } from '../components/report/NextActions';
import { __test__ as tierPickedTest } from '../components/report/TierPicked';

const { ACTION_COLOR, VARIANT_COLORS } = nextActionsTest;
const { TIER_COLOR } = tierPickedTest;

describe('ACTION_COLOR spec-pin (NextActions — intent-weight colour scale)', () => {
  it('has exactly 8 entries', () => {
    expect(Object.keys(ACTION_COLOR)).toHaveLength(8);
  });

  it('"purchase_paid_today" is dark green (#15803d) — highest intent', () => {
    expect(ACTION_COLOR['purchase_paid_today']).toBe('#15803d');
  });

  it('"leave" is red (#dc2626) — lowest intent', () => {
    expect(ACTION_COLOR['leave']).toBe('#dc2626');
  });

  it('"contact_sales" is green (#22c55e)', () => {
    expect(ACTION_COLOR['contact_sales']).toBe('#22c55e');
  });

  it('"start_free_hobby" is slate (#94a3b8)', () => {
    expect(ACTION_COLOR['start_free_hobby']).toBe('#94a3b8');
  });
});

describe('TIER_COLOR spec-pin (TierPicked — tier colour scale)', () => {
  it('has exactly 6 entries', () => {
    expect(Object.keys(TIER_COLOR)).toHaveLength(6);
  });

  it('"none" is red (#dc2626) — no tier', () => {
    expect(TIER_COLOR['none']).toBe('#dc2626');
  });

  it('"enterprise" is dark green (#15803d) — highest tier', () => {
    expect(TIER_COLOR['enterprise']).toBe('#15803d');
  });

  it('"hobby" is slate (#94a3b8)', () => {
    expect(TIER_COLOR['hobby']).toBe('#94a3b8');
  });

  it('"scale" is green (#22c55e)', () => {
    expect(TIER_COLOR['scale']).toBe('#22c55e');
  });
});

describe('cross-component color consistency (action vs tier scale)', () => {
  it('ACTION_COLOR["purchase_paid_today"] === TIER_COLOR["enterprise"] (same top-intent green)', () => {
    expect(ACTION_COLOR['purchase_paid_today']).toBe(TIER_COLOR['enterprise']);
  });

  it('ACTION_COLOR["leave"] === TIER_COLOR["none"] (same red)', () => {
    expect(ACTION_COLOR['leave']).toBe(TIER_COLOR['none']);
  });
});

describe('VARIANT_COLORS spec-pin (NextActions — Sankey source node palette)', () => {
  it('has exactly 5 entries', () => {
    expect(VARIANT_COLORS).toHaveLength(5);
  });

  it('first entry is indigo (#6366f1) — brand primary for variant A', () => {
    expect(VARIANT_COLORS[0]).toBe('#6366f1');
  });
});
