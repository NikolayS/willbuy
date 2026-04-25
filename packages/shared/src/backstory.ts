import { z } from 'zod';

// Spec §2 #5 + growth/ab/pricing-page-2026apr/personas/backstories.md.
// First pass: minimum permissive shape so the valid-fixture test passes.
// Enum tightening lands in the next red→green pair.

export const Backstory = z
  .object({
    name: z.string().min(1).describe('Display name for the sampled persona.'),
    role_archetype: z.unknown().describe('Spec §2 #5 (role archetype).'),
    stage: z.unknown().describe('Spec §2 #5 (stage).'),
    team_size: z.unknown().describe('Spec §2 #5 (team size).'),
    managed_postgres: z.unknown().describe('Spec §2 #5 (stack).'),
    current_pain: z.unknown().describe('Spec §2 #5 (pain).'),
    entry_point: z.unknown().describe('Spec §2 #5 (entry point).'),
    regulated: z
      .unknown()
      .describe('Refinement of spec §2 #5 from growth/personas/backstories.md.'),
    postgres_depth: z
      .unknown()
      .describe('Refinement of spec §2 #5 from growth/personas/backstories.md.'),
    budget_authority: z.unknown().describe('Spec §2 #5 (budget authority).'),
  })
  .passthrough();

export type BackstoryT = z.infer<typeof Backstory>;
