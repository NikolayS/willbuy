import { describe, expect, it } from 'vitest';
import { NEXT_ACTION_WEIGHTS, PAID_TIERS, scoreVisit } from '../src/scoring.js';
import type { VisitorOutputT } from '../src/visitor.js';

const baseVisit: VisitorOutputT = {
  first_impression: 'fine',
  will_to_buy: 5,
  questions: [],
  confusions: [],
  objections: [],
  unanswered_blockers: [],
  next_action: 'leave',
  confidence: 5,
  reasoning: 'placeholder',
  tier_picked_if_buying_today: 'none',
  highest_tier_willing_to_consider: 'none',
};

const visitWith = (
  next_action: VisitorOutputT['next_action'],
): VisitorOutputT => ({ ...baseVisit, next_action });

describe('scoreVisit (growth/ab/pricing-page-2026apr/scoring.md mirror)', () => {
  it('returns 1.0 for purchase_paid_today regardless of tier args', () => {
    expect(scoreVisit(visitWith('purchase_paid_today'))).toBe(1.0);
  });

  it('returns 0.8 for contact_sales', () => {
    expect(scoreVisit(visitWith('contact_sales'))).toBe(0.8);
  });

  it('returns 0.8 for book_demo', () => {
    expect(scoreVisit(visitWith('book_demo'))).toBe(0.8);
  });

  it('returns 0.6 for start_paid_trial', () => {
    expect(scoreVisit(visitWith('start_paid_trial'))).toBe(0.6);
  });

  it('returns 0.3 for bookmark_compare_later when tier_picked is paid', () => {
    expect(scoreVisit(visitWith('bookmark_compare_later'), 'starter')).toBe(
      0.3,
    );
  });

  it('returns 0.0 for bookmark_compare_later when tier_picked is not paid', () => {
    expect(scoreVisit(visitWith('bookmark_compare_later'), 'hobby')).toBe(0.0);
    expect(scoreVisit(visitWith('bookmark_compare_later'))).toBe(0.0);
  });

  it('returns 0.2 for start_free_hobby when considered tier is paid', () => {
    expect(
      scoreVisit(visitWith('start_free_hobby'), undefined, 'express'),
    ).toBe(0.2);
  });

  it('returns 0.0 for start_free_hobby when considered tier is not paid', () => {
    expect(
      scoreVisit(visitWith('start_free_hobby'), undefined, 'hobby'),
    ).toBe(0.0);
    expect(scoreVisit(visitWith('start_free_hobby'))).toBe(0.0);
  });

  it('returns 0.2 for ask_teammate', () => {
    expect(scoreVisit(visitWith('ask_teammate'))).toBe(0.2);
  });

  it('returns 0.0 for leave', () => {
    expect(scoreVisit(visitWith('leave'))).toBe(0.0);
  });

  it('exposes NEXT_ACTION_WEIGHTS mirroring the growth scoring rubric', () => {
    expect(NEXT_ACTION_WEIGHTS.purchase_paid_today).toBe(1.0);
    expect(NEXT_ACTION_WEIGHTS.contact_sales).toBe(0.8);
    expect(NEXT_ACTION_WEIGHTS.book_demo).toBe(0.8);
    expect(NEXT_ACTION_WEIGHTS.start_paid_trial).toBe(0.6);
    // bookmark_compare_later and start_free_hobby base = 0.0; bumps live in
    // scoreVisit per growth/scoring.md.
    expect(NEXT_ACTION_WEIGHTS.bookmark_compare_later).toBe(0.0);
    expect(NEXT_ACTION_WEIGHTS.start_free_hobby).toBe(0.0);
    expect(NEXT_ACTION_WEIGHTS.ask_teammate).toBe(0.2);
    expect(NEXT_ACTION_WEIGHTS.leave).toBe(0.0);
  });

  it('returns 0.0 defensively for an unknown next_action', () => {
    const malformed = {
      ...baseVisit,
      next_action: 'not_in_enum',
    } as unknown as VisitorOutputT;
    expect(scoreVisit(malformed)).toBe(0.0);
  });
});

describe('PAID_TIERS spec-pin (packages/shared/src/scoring.ts)', () => {
  it('has exactly 4 entries', () => {
    expect(PAID_TIERS.size).toBe(4);
  });

  it('contains "express"', () => {
    expect(PAID_TIERS.has('express')).toBe(true);
  });

  it('contains "starter"', () => {
    expect(PAID_TIERS.has('starter')).toBe(true);
  });

  it('contains "scale"', () => {
    expect(PAID_TIERS.has('scale')).toBe(true);
  });

  it('contains "enterprise"', () => {
    expect(PAID_TIERS.has('enterprise')).toBe(true);
  });

  it('"hobby" is NOT a paid tier (free plan)', () => {
    expect(PAID_TIERS.has('hobby')).toBe(false);
  });

  it('"none" is NOT a paid tier', () => {
    expect(PAID_TIERS.has('none')).toBe(false);
  });
});
