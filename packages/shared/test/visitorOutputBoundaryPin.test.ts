/**
 * visitorOutputBoundaryPin.test.ts — at-limit boundary spec-pins for
 * VisitorOutput fields (spec §2 #15). No fixture file needed.
 *
 * The existing visitor.test.ts covers over-limit rejections (>400, >1200, 11).
 * This file adds at-limit acceptance (exactly 400, exactly 1200, will_to_buy=0,
 * will_to_buy=10) and shortStringList boundary tests (10 items accepted,
 * 11 items rejected; item 200 chars accepted, 201 chars rejected).
 */

import { describe, it, expect } from 'vitest';
import { VisitorOutput } from '../src/visitor.js';

const BASE: Parameters<typeof VisitorOutput.parse>[0] = {
  first_impression: 'ok',
  will_to_buy: 5,
  questions: [],
  confusions: [],
  objections: [],
  unanswered_blockers: [],
  next_action: 'leave',
  confidence: 5,
  reasoning: 'ok',
};

describe('VisitorOutput — score0to10 boundary (spec §2 #15)', () => {
  it('accepts will_to_buy=0 (minimum)', () => {
    expect(VisitorOutput.safeParse({ ...BASE, will_to_buy: 0 }).success).toBe(true);
  });

  it('accepts will_to_buy=10 (maximum)', () => {
    expect(VisitorOutput.safeParse({ ...BASE, will_to_buy: 10 }).success).toBe(true);
  });

  it('rejects will_to_buy=11', () => {
    expect(VisitorOutput.safeParse({ ...BASE, will_to_buy: 11 }).success).toBe(false);
  });

  it('rejects will_to_buy=-1', () => {
    expect(VisitorOutput.safeParse({ ...BASE, will_to_buy: -1 }).success).toBe(false);
  });

  it('accepts confidence=0 (minimum)', () => {
    expect(VisitorOutput.safeParse({ ...BASE, confidence: 0 }).success).toBe(true);
  });

  it('accepts confidence=10 (maximum)', () => {
    expect(VisitorOutput.safeParse({ ...BASE, confidence: 10 }).success).toBe(true);
  });
});

describe('VisitorOutput — first_impression max=400 boundary (spec §2 #15)', () => {
  it('accepts first_impression of exactly 400 chars', () => {
    const r = VisitorOutput.safeParse({ ...BASE, first_impression: 'x'.repeat(400) });
    expect(r.success).toBe(true);
  });

  it('rejects first_impression of 401 chars', () => {
    const r = VisitorOutput.safeParse({ ...BASE, first_impression: 'x'.repeat(401) });
    expect(r.success).toBe(false);
  });
});

describe('VisitorOutput — reasoning max=1200 boundary (spec §2 #15)', () => {
  it('accepts reasoning of exactly 1200 chars', () => {
    const r = VisitorOutput.safeParse({ ...BASE, reasoning: 'r'.repeat(1200) });
    expect(r.success).toBe(true);
  });

  it('rejects reasoning of 1201 chars', () => {
    const r = VisitorOutput.safeParse({ ...BASE, reasoning: 'r'.repeat(1201) });
    expect(r.success).toBe(false);
  });
});

describe('VisitorOutput — shortStringList: list max=10, item max=200 (spec §2 #15)', () => {
  it('accepts a list of exactly 10 items', () => {
    const tenItems = Array.from({ length: 10 }, (_, i) => `item ${i}`);
    const r = VisitorOutput.safeParse({ ...BASE, questions: tenItems });
    expect(r.success).toBe(true);
  });

  it('rejects a list of 11 items', () => {
    const elevenItems = Array.from({ length: 11 }, (_, i) => `item ${i}`);
    const r = VisitorOutput.safeParse({ ...BASE, questions: elevenItems });
    expect(r.success).toBe(false);
  });

  it('accepts a list item of exactly 200 chars', () => {
    const r = VisitorOutput.safeParse({ ...BASE, confusions: ['c'.repeat(200)] });
    expect(r.success).toBe(true);
  });

  it('rejects a list item of 201 chars', () => {
    const r = VisitorOutput.safeParse({ ...BASE, confusions: ['c'.repeat(201)] });
    expect(r.success).toBe(false);
  });
});

describe('VisitorOutput — tier_picked enums (issue #173)', () => {
  const TIER_VALUES = ['none', 'hobby', 'express', 'starter', 'scale', 'enterprise'];

  it('accepts all 6 tier values for tier_picked_if_buying_today', () => {
    for (const tier of TIER_VALUES) {
      const r = VisitorOutput.safeParse({ ...BASE, tier_picked_if_buying_today: tier });
      expect(r.success, `tier=${tier}`).toBe(true);
    }
  });

  it('rejects unknown tier for tier_picked_if_buying_today', () => {
    const r = VisitorOutput.safeParse({
      ...BASE,
      tier_picked_if_buying_today: 'premium',
    });
    expect(r.success).toBe(false);
  });

  it('defaults tier_picked_if_buying_today to "none" when absent', () => {
    const r = VisitorOutput.safeParse(BASE);
    if (r.success) {
      expect(r.data.tier_picked_if_buying_today).toBe('none');
    } else {
      throw new Error('parse unexpectedly failed');
    }
  });
});
