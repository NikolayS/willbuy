import type { BackstoryT, VisitorOutputT } from '@willbuy/shared';

// A backstory shape that satisfies the @willbuy/shared zod schema —
// kept inline (not loaded from packages/shared/test/fixtures) so a
// future schema change forces a deliberate update here.
export const SAMPLE_BACKSTORY: BackstoryT = {
  name: 'Maya',
  role_archetype: 'founder_or_eng_lead',
  stage: 'series_a',
  team_size: 12,
  managed_postgres: 'supabase',
  current_pain: 'upcoming_scale_event',
  entry_point: 'newsletter',
  regulated: 'no',
  postgres_depth: 'light',
  budget_authority: 'self',
};

export const SAMPLE_PAGE_SNAPSHOT =
  'a11y-tree(redacted) Pricing page header: Postgres-as-a-Service. Tiers: hobby $0, starter $29, scale $99.';

// Spec §2 #15-shaped valid visitor output.
export const VALID_VISITOR_OUTPUT: VisitorOutputT = {
  first_impression:
    'Pricing page leads with a managed Postgres pitch; tiers are visible above the fold.',
  will_to_buy: 7,
  questions: ['Is there a self-hosted option?'],
  confusions: ['Connections cap unclear — pooled or client?'],
  objections: ['$99/mo is steep for a 2-eng team already on RDS.'],
  unanswered_blockers: ['No SOC2 mention — fintech blocker.'],
  next_action: 'contact_sales',
  confidence: 8,
  reasoning:
    'Strong pricing-page clarity but missing compliance signals; for a regulated fintech buyer the next step is sales.',
  tier_picked_if_buying_today: 'starter',
  highest_tier_willing_to_consider: 'scale',
};

export function validVisitorJsonString(): string {
  return JSON.stringify(VALID_VISITOR_OUTPUT);
}
