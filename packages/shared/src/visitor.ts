import { z } from 'zod';

// Spec §2 #15 (visitor output schema). Per-field length caps, integer
// ranges, enum tightening, array-shape enforcement, and required-field
// rules land in subsequent red→green pairs. This first commit is the
// minimum permissive shape that makes the valid-fixture test pass.

export const VisitorOutput = z
  .object({
    first_impression: z.unknown().describe('Spec §2 #15: first_impression.'),
    will_to_buy: z.unknown().describe('Spec §2 #15: will_to_buy.'),
    questions: z.unknown().describe('Spec §2 #15: questions[].'),
    confusions: z.unknown().describe('Spec §2 #15: confusions[].'),
    objections: z.unknown().describe('Spec §2 #15: objections[].'),
    unanswered_blockers: z
      .unknown()
      .describe('Spec §2 #15: unanswered_blockers[].'),
    next_action: z
      .unknown()
      .describe(
        'Spec §2 #15 + amendment A1 (2026-04-24): next_action enum (tightened in a later commit).',
      ),
    confidence: z.unknown().describe('Spec §2 #15: confidence.'),
    reasoning: z.unknown().describe('Spec §2 #15: reasoning.'),
  })
  .partial()
  .passthrough();

export type VisitorOutputT = z.infer<typeof VisitorOutput>;
