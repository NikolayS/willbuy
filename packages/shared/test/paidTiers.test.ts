/**
 * paidTiers.test.ts — spec-pin for PAID_TIERS and NextAction enum
 * (growth/ab/pricing-page-2026apr/scoring.md + spec §2 #15).
 *
 * The existing scoring.test.ts tests scoreVisit()'s PAID_TIERS behavior
 * via integration (passing 'starter', 'express', 'hobby') but never pins
 * the PAID_TIERS set contents or count directly. Changing these values
 * silently changes scoring bump eligibility.
 */

import { describe, it, expect } from 'vitest';
import { PAID_TIERS, NextAction } from '../src/scoring.js';

describe('PAID_TIERS spec-pin (scoring.md paid tier set)', () => {
  it('has exactly 4 paid tier strings', () => {
    expect(PAID_TIERS.size).toBe(4);
  });

  it('includes express', () => {
    expect(PAID_TIERS.has('express')).toBe(true);
  });

  it('includes starter', () => {
    expect(PAID_TIERS.has('starter')).toBe(true);
  });

  it('includes scale', () => {
    expect(PAID_TIERS.has('scale')).toBe(true);
  });

  it('includes enterprise', () => {
    expect(PAID_TIERS.has('enterprise')).toBe(true);
  });

  it('does NOT include "none" (free tier)', () => {
    expect(PAID_TIERS.has('none')).toBe(false);
  });

  it('does NOT include "hobby" (free tier)', () => {
    expect(PAID_TIERS.has('hobby')).toBe(false);
  });
});

describe('NextAction enum spec-pin (spec §2 #15)', () => {
  it('has exactly 8 next_action values', () => {
    expect(NextAction.options).toHaveLength(8);
  });

  it('includes all 8 expected values', () => {
    const expected = [
      'purchase_paid_today',
      'contact_sales',
      'book_demo',
      'start_paid_trial',
      'bookmark_compare_later',
      'start_free_hobby',
      'ask_teammate',
      'leave',
    ];
    for (const v of expected) {
      expect(NextAction.options).toContain(v);
    }
  });

  it('rejects values outside the enum', () => {
    expect(NextAction.safeParse('not_an_action').success).toBe(false);
  });
});
