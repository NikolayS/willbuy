import { z } from 'zod';

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
