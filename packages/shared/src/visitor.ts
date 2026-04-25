import { z } from 'zod';

import { NextAction } from './scoring.js';

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

// Spec §2 #15: questions/confusions/objections/unanswered_blockers are
// each ≤ 10 strings × ≤ 200 chars per string.
const shortStringList = z
  .array(
    z
      .string()
      .max(200, 'list items capped at 200 chars (spec §2 #15)'),
  )
  .max(10, 'list capped at 10 items (spec §2 #15)');

export const VisitorOutput = z
  .object({
    first_impression: firstImpression.describe(
      'Spec §2 #15: first_impression, ≤ 400 chars.',
    ),
    will_to_buy: score0to10.describe(
      'Spec §2 #15: will_to_buy integer 0–10.',
    ),
    questions: shortStringList.describe(
      'Spec §2 #15: questions[], ≤ 10 items × ≤ 200 chars each.',
    ),
    confusions: shortStringList.describe(
      'Spec §2 #15: confusions[], ≤ 10 items × ≤ 200 chars each.',
    ),
    objections: shortStringList.describe(
      'Spec §2 #15: objections[], ≤ 10 items × ≤ 200 chars each.',
    ),
    unanswered_blockers: shortStringList.describe(
      'Spec §2 #15: unanswered_blockers[], ≤ 10 items × ≤ 200 chars each.',
    ),
    next_action: NextAction.describe(
      'Spec §2 #15 + amendment A1 (2026-04-24): next_action enum aligned with growth scoring rubric.',
    ),
    confidence: anyValue.describe('Spec §2 #15: confidence.'),
    reasoning: anyValue.describe('Spec §2 #15: reasoning.'),
  })
  .passthrough();

export type VisitorOutputT = z.infer<typeof VisitorOutput>;
