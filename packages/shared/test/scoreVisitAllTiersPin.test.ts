/**
 * scoreVisitAllTiersPin.test.ts — exhaustive paid-tier coverage for
 * scoreVisit() bump rules (scoring.md / amendment A1).
 *
 * The existing scoring.test.ts checks the bump with only ONE paid tier per
 * rule ('starter' for bookmark_compare_later, 'express' for start_free_hobby).
 * This file asserts ALL four paid tiers trigger the bump and ALL non-paid
 * values do not — matching the Python test_score_visit.py exhaustive coverage.
 *
 * Spec refs:
 *   §5.5 + amendment A1 — PAID_TIERS bump rules for scoreVisit().
 */

import { describe, it, expect } from 'vitest';
import { scoreVisit } from '../src/scoring.js';
import type { VisitorOutputT } from '../src/visitor.js';

const PAID_TIERS = ['express', 'starter', 'scale', 'enterprise'] as const;
const NON_PAID_TIERS = ['none', 'hobby'] as const;

function visit(next_action: VisitorOutputT['next_action']): VisitorOutputT {
  return {
    first_impression: 'ok',
    will_to_buy: 5,
    questions: [],
    confusions: [],
    objections: [],
    unanswered_blockers: [],
    next_action,
    confidence: 5,
    reasoning: 'ok',
    tier_picked_if_buying_today: 'none',
    highest_tier_willing_to_consider: 'none',
  };
}

describe('scoreVisit bookmark_compare_later bump — all paid tiers (amendment A1)', () => {
  for (const tier of PAID_TIERS) {
    it(`returns 0.3 when tier_picked_if_buying_today="${tier}"`, () => {
      expect(scoreVisit(visit('bookmark_compare_later'), tier)).toBe(0.3);
    });
  }

  for (const tier of NON_PAID_TIERS) {
    it(`returns 0.0 when tier_picked_if_buying_today="${tier}" (not paid)`, () => {
      expect(scoreVisit(visit('bookmark_compare_later'), tier)).toBe(0.0);
    });
  }

  it('returns 0.0 when tier_picked_if_buying_today is undefined', () => {
    expect(scoreVisit(visit('bookmark_compare_later'))).toBe(0.0);
  });
});

describe('scoreVisit start_free_hobby bump — all paid tiers (amendment A1)', () => {
  for (const tier of PAID_TIERS) {
    it(`returns 0.2 when highest_tier_willing_to_consider="${tier}"`, () => {
      expect(scoreVisit(visit('start_free_hobby'), undefined, tier)).toBe(0.2);
    });
  }

  for (const tier of NON_PAID_TIERS) {
    it(`returns 0.0 when highest_tier_willing_to_consider="${tier}" (not paid)`, () => {
      expect(scoreVisit(visit('start_free_hobby'), undefined, tier)).toBe(0.0);
    });
  }

  it('returns 0.0 when highest_tier_willing_to_consider is undefined', () => {
    expect(scoreVisit(visit('start_free_hobby'))).toBe(0.0);
  });
});
