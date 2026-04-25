// Spec §2 #14, §2 #15. Prompt builders for the visitor-worker.
//
// The static prefix is byte-identical across all visits — it is the
// system instructions + structured-output spec, and is the only part
// the LLMProvider should mark cacheable per spec §1 prompt-caching
// carve-out (the actual cache marker wiring is Sprint-2; here we just
// guarantee determinism).
//
// The dynamic tail (per-visit) and the repair tail (per-repair) carry
// the persona-specific and prior-bad-output payloads. Per spec §2 #14
// + §5.15, schema-repair retries are FRESH-CONTEXT calls: the prior
// raw output is passed BACK as user-role content with a correction
// instruction, NEVER as an assistant-role turn. This module builds
// only user-role strings; the assertion that no assistant turn ever
// reaches the model is therefore structural.

import type { BackstoryT } from '@willbuy/shared';

// Sentinel that lets tests grep the repair tail unambiguously to assert
// the prior bad output is present as user content (not assistant role).
// Public — used by tests in this package.
export const PRIOR_BAD_OUTPUT_MARKER = 'PRIOR_BAD_OUTPUT_BEGIN';
export const PRIOR_BAD_OUTPUT_END_MARKER = 'PRIOR_BAD_OUTPUT_END';

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

export function buildRepairTail(
  backstory: BackstoryT,
  pageSnapshot: string,
  priorRawOutput: string,
  validationError: string,
): string {
  // The repair payload is a SINGLE user-role string. The prior bad output
  // is embedded between explicit markers so the model parses it as data,
  // not as a continuation of its own prior turn. Per spec §2 #14 we never
  // emit an assistant role — the orchestrator only ever calls chat() with
  // staticPrefix + dynamicTail (one user payload), and chat() at the
  // adapter level builds a single user-role message from those.
  return [
    buildDynamicTail(backstory, pageSnapshot),
    '',
    'PRIOR_ATTEMPT_FAILED_VALIDATION:',
    `validation_error: ${validationError}`,
    PRIOR_BAD_OUTPUT_MARKER,
    priorRawOutput,
    PRIOR_BAD_OUTPUT_END_MARKER,
    '',
    'Re-emit a fresh JSON object that obeys the VisitorOutput schema.',
    'Do NOT echo the prior attempt. Do NOT reference your earlier output.',
    'Output exactly one valid JSON object.',
  ].join('\n');
}
