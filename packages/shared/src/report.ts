import { z } from 'zod';

import { NextAction } from './scoring.js';

// Spec §5.18 — report visualization wire shape.
//
// This is the contract between the aggregator (issue #31) and the report
// page (issue #35). The aggregator pre-computes a compact JSON blob on
// the `reports` row (per §5.18 perf budget — "no raw per-visit data over
// the wire"); this schema defines that blob.
//
// Field naming mirrors §5.18's seven elements 1:1 so a reviewer can
// match the schema to the spec section without translation:
//   1. headline      — element 1 (header / headline delta)
//   2. paired_dots   — element 2 (paired-delta dot plot)
//   3. histograms    — element 3 (will-to-buy histograms per variant)
//   4. next_actions  — element 4 (next-action stacked bar / Sankey)
//   5. tier_picked   — element 5 (tier-picked distribution per variant)
//   6. theme_board   — element 6 (top blockers/objections/confusions/questions)
//   7. personas      — element 7 (persona cards grid)
//
// `meta` carries study-level context (slug, n_paired, low_power flag from
// spec §9 "Statistical overclaim" risk row).

const variantId = z.enum(['A', 'B']);
export type VariantId = z.infer<typeof variantId>;

// Spec §2 #19 — paired statistics. Disagreement banner fires when paired-t
// and Wilcoxon disagree at α=0.05 (one < 0.05, the other ≥ 0.05). The
// aggregator decides; the report page just renders.
const headline = z.object({
  mean_delta: z.number(),
  ci95_low: z.number(),
  ci95_high: z.number(),
  n_paired: z.number().int().min(0),
  paired_t_p: z.number().min(0).max(1),
  wilcoxon_p: z.number().min(0).max(1),
  mcnemar_p: z.number().min(0).max(1),
  // 'better' / 'worse' / 'inconclusive' — the one-line verdict per §5.18 #1.
  verdict: z.enum(['better', 'worse', 'inconclusive']),
  // Spec §2 #19: explicit disagreement flag. When true the page shows a
  // banner and uses the conservative (larger) p-value in claim copy.
  disagreement: z.boolean(),
});

// Spec §5.18 #2 — one row per backstory with both A and B scores. Hover/
// click reveals backstory + both verdicts; aggregator includes the small
// strings inline (cheap) and the page lazy-loads full responses on
// expand (gated by share token per §5.18 perf budget).
const pairedDot = z.object({
  backstory_id: z.string(),
  // Display name only — never email / real PII (public-repo audit).
  backstory_name: z.string(),
  role: z.enum(['founder_or_eng_lead', 'ic_engineer']),
  score_a: z.number().min(0).max(10),
  score_b: z.number().min(0).max(10),
  // Per §5.18 #2 swing direction is a derived field but the aggregator
  // pre-computes for color coding stability across re-renders.
  swing: z.enum(['a_wins', 'tie', 'b_wins']),
});

// Spec §5.18 #3 — discrete 0–10 bins per variant. mean and median
// annotated.
const histogram = z.object({
  variant: variantId,
  // Length 11 (0..10 inclusive). Counts of `ok` visits in each bin.
  bins: z.array(z.number().int().min(0)).length(11),
  mean: z.number().min(0).max(10),
  median: z.number().min(0).max(10),
});

// Spec §5.18 #4 + amendment A1 — next-action distribution per variant.
// Eight enum values from amendment A1; ordered by intent weight in the UI.
const nextActionRow = z.object({
  variant: variantId,
  // counts[next_action] = count of ok visits with that next_action.
  counts: z.record(NextAction, z.number().int().min(0)),
});

// Spec §5.18 #5 — tier-picked distribution per variant. Six tiers
// (none/hobby/express/starter/scale/enterprise); horizontal stacked bar.
const tier = z.enum(['none', 'hobby', 'express', 'starter', 'scale', 'enterprise']);
export type Tier = z.infer<typeof tier>;
const tierRow = z.object({
  variant: variantId,
  counts: z.record(tier, z.number().int().min(0)),
});

// Spec §5.18 #6 — theme board. Four categories; clusters labeled by the
// LLM cluster-label step (§5.7); raw quotes are redacted per §5.9.
//
// Only cluster summaries ride the public report wire; the quote drawer
// loads attributions on demand (auth-gated).
const themeCategory = z.enum(['blockers', 'objections', 'confusions', 'questions']);
export type ThemeCategory = z.infer<typeof themeCategory>;
const themeCluster = z.object({
  cluster_id: z.string(),
  label: z.string().max(80),
  count: z.number().int().min(0),
});
const themeBoard = z.record(themeCategory, z.array(themeCluster));

// Spec §5.18 #7 — persona card grid; sortable by |score_b - score_a|.
// Backstory text is loaded on-demand when the card is expanded (§5.18
// perf budget). The grid view carries only what's needed to render and
// sort.
const persona = z.object({
  backstory_id: z.string(),
  backstory_name: z.string(),
  role: z.enum(['founder_or_eng_lead', 'ic_engineer']),
  stage: z.string(),
  team_size: z.number().int(),
  stack: z.string(),
  current_pain: z.string(),
  entry_point: z.string(),
  score_a: z.number().min(0).max(10),
  score_b: z.number().min(0).max(10),
  // Inline preview strings; full per-variant response loads on expand.
  verdict_a: z.string().max(400),
  verdict_b: z.string().max(400),
});

const meta = z.object({
  slug: z.string(),
  // Spec §9 statistical overclaim row — N<20 displays a low-power warning.
  // Aggregator sets this; the report page just toggles a banner.
  low_power: z.boolean(),
});

export const Report = z.object({
  meta,
  headline,
  paired_dots: z.array(pairedDot),
  histograms: z.array(histogram).length(2),
  next_actions: z.array(nextActionRow).length(2),
  tier_picked: z.array(tierRow).length(2),
  theme_board: themeBoard,
  personas: z.array(persona),
});

export type ReportT = z.infer<typeof Report>;
