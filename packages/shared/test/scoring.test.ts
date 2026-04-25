import { describe, expect, it } from 'vitest';
import { scoreVisit } from '../src/scoring.js';
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
};

const visitWith = (
  next_action: VisitorOutputT['next_action'],
): VisitorOutputT => ({ ...baseVisit, next_action });

describe('scoreVisit (growth/ab/pricing-page-2026apr/scoring.md mirror)', () => {
  it('returns 1.0 for purchase_paid_today regardless of tier args', () => {
    expect(scoreVisit(visitWith('purchase_paid_today'))).toBe(1.0);
  });
});
