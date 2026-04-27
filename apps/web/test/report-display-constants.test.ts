/**
 * report-display-constants.test.ts — spec-pins for ORDERED_ACTIONS + ACTION_LABEL
 * (NextActions.tsx) and ORDERED_TIERS + TIER_LABEL (TierPicked.tsx).
 *
 * ORDERED_ACTIONS (8 entries, amendment A1):
 *   Ordered by intent weight — purchase_paid_today first, leave last. This order
 *   determines the stacking order in the bar chart and the node order in the
 *   Sankey diagram. Reordering silently reverses the visual intent gradient.
 *   Must match VALID_NEXT_ACTIONS in the Python aggregator.
 *
 * ACTION_LABEL (8 entries):
 *   Human-readable labels for the chart legend + Sankey node labels. A label
 *   change affects what users read in the report. A key rename renders
 *   'undefined' for that action's bar/node.
 *
 * ORDERED_TIERS (6 entries):
 *   Ordered from none → enterprise (ascending commercial intent). Used as the
 *   stacking order for the horizontal tier bar chart. Reordering reverses the
 *   visual intent gradient. Must match VALID_TIERS in the Python aggregator.
 *
 * TIER_LABEL (6 entries):
 *   Human-readable tier names in the chart legend. A key rename renders
 *   'undefined' for that tier's bar segment.
 */

import { describe, expect, it } from 'vitest';
import { __test__ as nextActionsTest } from '../components/report/NextActions';
import { __test__ as tierPickedTest } from '../components/report/TierPicked';

const { ORDERED_ACTIONS, ACTION_LABEL } = nextActionsTest;
const { ORDERED_TIERS, TIER_LABEL } = tierPickedTest;

describe('ORDERED_ACTIONS spec-pin (NextActions — amendment A1 intent order)', () => {
  it('has exactly 8 entries', () => {
    expect(ORDERED_ACTIONS).toHaveLength(8);
  });

  it('first entry is "purchase_paid_today" (highest intent)', () => {
    expect(ORDERED_ACTIONS[0]).toBe('purchase_paid_today');
  });

  it('last entry is "leave" (lowest intent)', () => {
    expect(ORDERED_ACTIONS[ORDERED_ACTIONS.length - 1]).toBe('leave');
  });

  it('contains all expected action keys', () => {
    const expected = [
      'purchase_paid_today',
      'contact_sales',
      'book_demo',
      'start_paid_trial',
      'bookmark_compare_later',
      'ask_teammate',
      'start_free_hobby',
      'leave',
    ];
    for (const a of expected) {
      expect(ORDERED_ACTIONS).toContain(a);
    }
  });
});

describe('ACTION_LABEL spec-pin (NextActions — chart legend labels)', () => {
  it('has exactly 8 entries', () => {
    expect(Object.keys(ACTION_LABEL)).toHaveLength(8);
  });

  it('"purchase_paid_today" → "Purchase today"', () => {
    expect(ACTION_LABEL['purchase_paid_today']).toBe('Purchase today');
  });

  it('"leave" → "Leave"', () => {
    expect(ACTION_LABEL['leave']).toBe('Leave');
  });

  it('every ORDERED_ACTIONS entry has a label', () => {
    for (const action of ORDERED_ACTIONS) {
      expect(ACTION_LABEL[action]).toBeTruthy();
    }
  });
});

describe('ORDERED_TIERS spec-pin (TierPicked — ascending commercial intent)', () => {
  it('has exactly 6 entries', () => {
    expect(ORDERED_TIERS).toHaveLength(6);
  });

  it('first entry is "none"', () => {
    expect(ORDERED_TIERS[0]).toBe('none');
  });

  it('last entry is "enterprise"', () => {
    expect(ORDERED_TIERS[ORDERED_TIERS.length - 1]).toBe('enterprise');
  });

  it('contains "hobby", "express", "starter", "scale"', () => {
    for (const t of ['hobby', 'express', 'starter', 'scale']) {
      expect(ORDERED_TIERS).toContain(t);
    }
  });
});

describe('TIER_LABEL spec-pin (TierPicked — chart legend labels)', () => {
  it('has exactly 6 entries', () => {
    expect(Object.keys(TIER_LABEL)).toHaveLength(6);
  });

  it('"none" → "None"', () => {
    expect(TIER_LABEL['none']).toBe('None');
  });

  it('"enterprise" → "Enterprise"', () => {
    expect(TIER_LABEL['enterprise']).toBe('Enterprise');
  });

  it('every ORDERED_TIERS entry has a label', () => {
    for (const tier of ORDERED_TIERS) {
      expect(TIER_LABEL[tier]).toBeTruthy();
    }
  });
});
