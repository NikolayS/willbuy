import { z } from 'zod';

// Spec §2 #15 (visitor output schema). Length caps, integer ranges, enum
// tightening, and array-shape enforcement land in subsequent red→green
// pairs. This first pass requires every key to be present (per spec §2 #15
// "all nine fields") with permissive value shapes.

const anyValue = z.any().refine((v) => v !== undefined, {
  message: 'field is required (spec §2 #15)',
});

// Spec §2 #15 caps first_impression at 400 chars; rejecting longer
// strings is what triggers the schema-repair retry path (§2 #14).
const firstImpression = z
  .string()
  .max(400, 'first_impression capped at 400 chars (spec §2 #15)');

// Spec §2 #15: will_to_buy and confidence are integers 0–10.
const score0to10 = z.number().int().min(0).max(10);

export const VisitorOutput = z
  .object({
    first_impression: firstImpression.describe(
      'Spec §2 #15: first_impression, ≤ 400 chars.',
    ),
    will_to_buy: score0to10.describe(
      'Spec §2 #15: will_to_buy integer 0–10.',
    ),
    questions: anyValue.describe('Spec §2 #15: questions[].'),
    confusions: anyValue.describe('Spec §2 #15: confusions[].'),
    objections: anyValue.describe('Spec §2 #15: objections[].'),
    unanswered_blockers: anyValue.describe(
      'Spec §2 #15: unanswered_blockers[].',
    ),
    next_action: anyValue.describe(
      'Spec §2 #15 + amendment A1 (2026-04-24): next_action enum (tightened in a later commit).',
    ),
    confidence: anyValue.describe('Spec §2 #15: confidence.'),
    reasoning: anyValue.describe('Spec §2 #15: reasoning.'),
  })
  .passthrough();

export type VisitorOutputT = z.infer<typeof VisitorOutput>;
