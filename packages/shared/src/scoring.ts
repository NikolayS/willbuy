import { z } from 'zod';

import type { VisitorOutputT } from './visitor.js';

// Spec §2 #15 + amendment A1 (2026-04-24): next_action enum mirrors the
// growth scoring rubric in ab/pricing-page-2026apr/scoring.md.
export const NextAction = z.enum([
  'purchase_paid_today',
  'contact_sales',
  'book_demo',
  'start_paid_trial',
  'bookmark_compare_later',
  'start_free_hobby',
  'ask_teammate',
  'leave',
]);

export type NextActionT = z.infer<typeof NextAction>;

// Paid tiers per growth/ab/pricing-page-2026apr/scoring.md (the postgres.ai
// pricing rubric for the 2026-04 study). bookmark_compare_later is bumped
// to 0.3 when tier_picked_if_buying_today ∈ PAID_TIERS, and start_free_hobby
// is bumped to 0.2 when highest_tier_willing_to_consider ∈ PAID_TIERS.
export const PAID_TIERS: ReadonlySet<string> = new Set([
  'express',
  'starter',
  'scale',
  'enterprise',
]);

// Base weight map per growth/ab/pricing-page-2026apr/scoring.md. The
// bookmark_compare_later and start_free_hobby rows are 0.0 here; their
// bumps to 0.3 / 0.2 fire conditionally inside scoreVisit when the
// corresponding paid-tier signal is present.
export const NEXT_ACTION_WEIGHTS: Record<NextActionT, number> = {
  purchase_paid_today: 1.0,
  contact_sales: 0.8,
  book_demo: 0.8,
  start_paid_trial: 0.6,
  bookmark_compare_later: 0.0,
  start_free_hobby: 0.0,
  ask_teammate: 0.2,
  leave: 0.0,
};

// Mirrors the weight map + bump rules in
// growth/ab/pricing-page-2026apr/scoring.md verbatim.
export function scoreVisit(
  parsed: VisitorOutputT,
  tierToday?: string,
  considered?: string,
): number {
  if (parsed.next_action === 'bookmark_compare_later') {
    return tierToday !== undefined && PAID_TIERS.has(tierToday) ? 0.3 : 0.0;
  }
  if (parsed.next_action === 'start_free_hobby') {
    return considered !== undefined && PAID_TIERS.has(considered) ? 0.2 : 0.0;
  }
  const base = NEXT_ACTION_WEIGHTS[parsed.next_action as NextActionT];
  return typeof base === 'number' ? base : 0.0;
}
