import { z } from 'zod';

// Spec §2 #5 ("Custom-ICP authoring form (free-text description + structured
// fields: stage, team size, stack, pain, entry point, budget authority)")
// pinned to the concrete value sets from growth/ab/pricing-page-2026apr/
// personas/backstories.md (the postgres.ai pricing rubric for the 2026-04
// study). See SPEC.willbuy.amendments.md A1 for traceability.

export const Stage = z.enum(['seed', 'seed+', 'series_a', 'series_b']);
export type StageT = z.infer<typeof Stage>;

export const TeamSize = z.union([
  z.literal(2),
  z.literal(6),
  z.literal(12),
  z.literal(20),
]);
export type TeamSizeT = z.infer<typeof TeamSize>;

export const ManagedPostgres = z.enum([
  'supabase',
  'neon',
  'rds',
  'aurora',
  'cloud_sql',
]);
export type ManagedPostgresT = z.infer<typeof ManagedPostgres>;

export const CurrentPain = z.enum([
  'recent_outage',
  'slow_queries',
  'bad_migration_fear',
  'cost_creep',
  'upcoming_scale_event',
  'post_mortem_in_hand',
]);
export type CurrentPainT = z.infer<typeof CurrentPain>;

export const EntryPoint = z.enum([
  'hacker_news',
  'newsletter',
  'vc_referral',
  'google_search',
  'postgres_blog_footer',
  'conference_booth_followup',
]);
export type EntryPointT = z.infer<typeof EntryPoint>;

export const Regulated = z.enum(['no', 'lightly', 'yes']);
export type RegulatedT = z.infer<typeof Regulated>;

export const PostgresDepth = z.enum(['light', 'medium', 'deep']);
export type PostgresDepthT = z.infer<typeof PostgresDepth>;

export const BudgetAuthority = z.enum([
  'self',
  'needs_founder_signoff',
  'needs_manager_signoff',
  'needs_board_visibility',
]);
export type BudgetAuthorityT = z.infer<typeof BudgetAuthority>;

export const RoleArchetype = z.enum(['founder_or_eng_lead', 'ic_engineer']);
export type RoleArchetypeT = z.infer<typeof RoleArchetype>;

export const Backstory = z
  .object({
    name: z
      .string()
      .min(1)
      .describe('Display name for the sampled persona (e.g. "Maya").'),
    role_archetype: RoleArchetype.describe(
      'Spec §2 #5 (custom-ICP role) — `founder_or_eng_lead` or `ic_engineer`.',
    ),
    stage: Stage.describe(
      'Spec §2 #5 (stage); growth/personas/backstories.md value set.',
    ),
    team_size: TeamSize.describe(
      'Spec §2 #5 (team size); growth/personas/backstories.md fixed quartiles.',
    ),
    managed_postgres: ManagedPostgres.describe(
      'Spec §2 #5 (stack); growth/personas/backstories.md value set.',
    ),
    current_pain: CurrentPain.describe(
      'Spec §2 #5 (pain); growth/personas/backstories.md value set.',
    ),
    entry_point: EntryPoint.describe(
      'Spec §2 #5 (entry point); growth/personas/backstories.md value set.',
    ),
    regulated: Regulated.describe(
      'Refinement of spec §2 #5 from growth/personas/backstories.md.',
    ),
    postgres_depth: PostgresDepth.describe(
      'Refinement of spec §2 #5 from growth/personas/backstories.md.',
    ),
    budget_authority: BudgetAuthority.describe(
      'Spec §2 #5 (budget authority); growth/personas/backstories.md value set.',
    ),
  })
  .strict();

export type BackstoryT = z.infer<typeof Backstory>;
