// Spec §2 #14, §2 #15. Prompt builders for the visitor-worker.
//
// The static prefix is byte-identical across all visits — it is the
// system instructions + structured-output spec, and is the only part
// the LLMProvider should mark cacheable per spec §1 prompt-caching
// carve-out (the actual cache marker wiring is Sprint-2; here we just
// guarantee determinism).
//
// The dynamic tail (per-visit) carries the persona-specific payload.
// At this step the orchestrator only ever issues a single chat() call
// per visit; the repair-tail builder lands with acceptance #2.

import type { BackstoryT } from '@willbuy/shared';

// Spec §2 #14 carve-out: production prompt copy is tuned in the Sprint-3
// 5-page benchmark. v0.1 ships a placeholder that is deterministic and
// names the structured-output expectation in plain English. The exact
// wording is not load-bearing for any acceptance — only that the prefix
// is byte-identical across every visit (so the cacheability invariant
// holds) and the tail carries the per-visit content.
const STATIC_PREFIX = [
  'You are a synthetic visitor evaluating a landing or pricing page.',
  'You will be given (a) a persona backstory and (b) a redacted snapshot',
  'of the captured page. Your job: respond ONLY with a single JSON object',
  'matching the willbuy VisitorOutput schema (spec §2 #15). Caps:',
  '  first_impression  ≤ 400 chars',
  '  questions[]       ≤ 10 × 200 chars',
  '  confusions[]      ≤ 10 × 200 chars',
  '  objections[]      ≤ 10 × 200 chars',
  '  unanswered_blockers[] ≤ 10 × 200 chars',
  '  reasoning         ≤ 1200 chars',
  '  will_to_buy, confidence ∈ integer 0..10',
  '  next_action ∈ {purchase_paid_today, contact_sales, book_demo,',
  '                 start_paid_trial, bookmark_compare_later,',
  '                 start_free_hobby, ask_teammate, leave}',
  'Do NOT include commentary outside the JSON object. Do NOT wrap the',
  'JSON in code fences. Output exactly one valid JSON object.',
].join('\n');

export function buildStaticPrefix(): string {
  return STATIC_PREFIX;
}

function renderBackstory(b: BackstoryT): string {
  // Stable ordering — labeled rendering reads better at the top of the
  // prompt and is what the production prompt copy will likely use.
  const lines = [
    `name: ${b.name}`,
    `role_archetype: ${b.role_archetype}`,
    `stage: ${b.stage}`,
    `team_size: ${b.team_size}`,
    `managed_postgres: ${b.managed_postgres}`,
    `current_pain: ${b.current_pain}`,
    `entry_point: ${b.entry_point}`,
    `regulated: ${b.regulated}`,
    `postgres_depth: ${b.postgres_depth}`,
    `budget_authority: ${b.budget_authority}`,
  ];
  return lines.join('\n');
}

export function buildDynamicTail(
  backstory: BackstoryT,
  pageSnapshot: string,
): string {
  return [
    'BACKSTORY:',
    renderBackstory(backstory),
    '',
    'PAGE_SNAPSHOT:',
    pageSnapshot,
  ].join('\n');
}
