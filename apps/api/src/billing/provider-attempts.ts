/**
 * provider-attempts.ts — §16 unified provider-attempt ledger.
 *
 * startAttempt: inserts a 'started' row BEFORE the outbound provider call.
 *   This is the write-before-call invariant: the row exists even if the
 *   subprocess crashes after the insert (AC6 in the test suite).
 *
 * endAttempt: transitions the row to 'ended' | 'indeterminate' |
 *   'indeterminate_refunded'. On 'indeterminate' the actual_cents is set to
 *   the pessimistic est_cents ceiling (spec §5.5 / §2 #15).
 *
 * Reconciliation of 'indeterminate' rows is Sprint 3 (out of scope here).
 */

import type postgres from 'postgres';
import type { SpendKind } from './atomic-spend.js';

export type AttemptStatus = 'started' | 'ended' | 'indeterminate' | 'indeterminate_refunded';

export type StartAttemptInput = {
  sql: ReturnType<typeof postgres>;
  account_id: bigint;
  study_id: bigint;
  kind: SpendKind;
  logical_request_key: string;
  provider: string;
  model: string;
  // est_cents removed: provider_attempts.cost_cents is written at endAttempt
  // time (actual_cents), not at start. The reservation is tracked by
  // llm_spend_daily via reserveSpend before this call.
};

export type EndAttemptInput = {
  sql: ReturnType<typeof postgres>;
  id: bigint;
  status: 'ended' | 'indeterminate' | 'indeterminate_refunded';
  actual_cents: number;
  raw_output_key?: string;
  error_class?: string;
};

/**
 * Insert a provider_attempts row with status='started'.
 * Returns the new row id. MUST be called before the outbound provider call.
 */
export async function startAttempt(input: StartAttemptInput): Promise<bigint> {
  const { sql, account_id, study_id, kind, logical_request_key, provider, model } = input;

  const rows = await sql<[{ id: bigint }]>`
    INSERT INTO provider_attempts (
      account_id, study_id, kind,
      logical_request_key, provider, model,
      transport_attempts, status, cost_cents,
      started_at
    )
    VALUES (
      ${String(account_id)}, ${String(study_id)}, ${kind},
      ${logical_request_key}, ${provider}, ${model},
      0, 'started', 0,
      now()
    )
    RETURNING id
  `;
  return rows[0]!.id;
}

/**
 * Update a provider_attempts row on completion.
 *
 * On status='indeterminate' the pessimistic debit is already reserved in
 * llm_spend_daily (the caller did reserveSpend before calling the provider).
 * The cost_cents is set to actual_cents so the reconciliation job can later
 * compare against the provider's billing line items.
 *
 * On status='indeterminate' with actual_cents=0 the caller should pass
 * est_cents as the pessimistic cost, per spec §5.5 / §2 #15.
 */
export async function endAttempt(input: EndAttemptInput): Promise<void> {
  const { sql, id, status, actual_cents, raw_output_key, error_class } = input;

  await sql`
    UPDATE provider_attempts
    SET
      status        = ${status},
      cost_cents    = ${actual_cents},
      ended_at      = now(),
      raw_output_key = ${raw_output_key ?? null},
      error_class    = ${error_class ?? null}
    WHERE id = ${String(id)}
  `;
}
