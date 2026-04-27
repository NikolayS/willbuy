/**
 * report-display-constants.test.ts — spec-pins for report chart display constants.
 *
 * Spec §5.18 #4 (next-action chart) + §5.18 #5 (tier-picked chart).
 *
 * ORDERED_ACTIONS: the 8-element display order of the next_action chart.
 *   Must match the NextActionT enum (spec §2 #15 / amendment A1). Order
 *   is descending intent weight — changing it reorders chart bars and
 *   could misrepresent high-intent vs low-intent action proportions.
 *
 * ACTION_LABEL: human-readable names shown in the chart legend.
 *   'purchase_paid_today' → 'Purchase today' etc.
 *
 * ORDERED_TIERS: the 6-element display order for tier-picked distribution.
 *   Must match the Tier type in shared/src/report.ts.
 *
 * TIER_LABEL: 'none' → 'None', 'hobby' → 'Hobby', etc.
 */

import { describe, expect, it } from 'vitest';
import { __test__ as nextActionsTest } from '../components/report/NextActions';
import { __test__ as tierPickedTest } from '../components/report/TierPicked';

const { ORDERED_ACTIONS, ACTION_LABEL } = nextActionsTest;
const { ORDERED_TIERS, TIER_LABEL } = tierPickedTest;

// ── ORDERED_ACTIONS (spec §2 #15 / amendment A1) ─────────────────────────────

describe('ORDERED_ACTIONS spec-pin (spec §5.18 #4)', () => {
  it('contains exactly 8 actions', () => {
    expect(ORDERED_ACTIONS).toHaveLength(8);
  });

  it('matches the NextActionT enum set (spec §2 #15 / amendment A1)', () => {
    const expected = new Set([
      'purchase_paid_today', 'contact_sales', 'book_demo', 'start_paid_trial',
      'bookmark_compare_later', 'ask_teammate', 'start_free_hobby', 'leave',
    ]);
    expect(new Set(ORDERED_ACTIONS)).toEqual(expected);
  });

  it('opens with purchase_paid_today (highest intent first)', () => {
    expect(ORDERED_ACTIONS[0]).toBe('purchase_paid_today');
  });

  it('closes with leave (lowest intent last)', () => {
    expect(ORDERED_ACTIONS[ORDERED_ACTIONS.length - 1]).toBe('leave');
  });
});

// ── ACTION_LABEL ─────────────────────────────────────────────────────────────

describe('ACTION_LABEL spec-pin (spec §5.18 #4)', () => {
  it('purchase_paid_today → "Purchase today"', () => {
    expect(ACTION_LABEL['purchase_paid_today']).toBe('Purchase today');
  });

  it('leave → "Leave"', () => {
    expect(ACTION_LABEL['leave']).toBe('Leave');
  });

  it('has a label for every ORDERED_ACTIONS entry', () => {
    for (const action of ORDERED_ACTIONS) {
      expect(ACTION_LABEL[action]).toBeTruthy();
    }
  });
});

// ── ORDERED_TIERS (spec §5.18 #5) ────────────────────────────────────────────

describe('ORDERED_TIERS spec-pin (spec §5.18 #5)', () => {
  it('contains exactly 6 tiers', () => {
    expect(ORDERED_TIERS).toHaveLength(6);
  });

  it('matches the Tier set: none, hobby, express, starter, scale, enterprise', () => {
    const expected = new Set(['none', 'hobby', 'express', 'starter', 'scale', 'enterprise']);
    expect(new Set(ORDERED_TIERS)).toEqual(expected);
  });

  it('starts with none and ends with enterprise', () => {
    expect(ORDERED_TIERS[0]).toBe('none');
    expect(ORDERED_TIERS[ORDERED_TIERS.length - 1]).toBe('enterprise');
  });
});

// ── TIER_LABEL ────────────────────────────────────────────────────────────────

describe('TIER_LABEL spec-pin (spec §5.18 #5)', () => {
  it('has a label for every ORDERED_TIERS entry', () => {
    for (const tier of ORDERED_TIERS) {
      expect(TIER_LABEL[tier]).toBeTruthy();
    }
  });

  it('none → "None", enterprise → "Enterprise"', () => {
    expect(TIER_LABEL['none']).toBe('None');
    expect(TIER_LABEL['enterprise']).toBe('Enterprise');
  });
});
