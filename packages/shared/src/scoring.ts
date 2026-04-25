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

// Mirrors the weight map in growth/ab/pricing-page-2026apr/scoring.md
// verbatim. Each red→green pair below extends this map with one branch
// from the rubric.
export function scoreVisit(
  parsed: VisitorOutputT,
  tierToday?: string,
  _considered?: string,
): number {
  if (parsed.next_action === 'purchase_paid_today') return 1.0;
  if (parsed.next_action === 'contact_sales') return 0.8;
  if (parsed.next_action === 'book_demo') return 0.8;
  if (parsed.next_action === 'start_paid_trial') return 0.6;
  if (parsed.next_action === 'bookmark_compare_later') {
    return tierToday !== undefined && PAID_TIERS.has(tierToday) ? 0.3 : 0.0;
  }
  return 0.0;
}
