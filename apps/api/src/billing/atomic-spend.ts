/**
 * atomic-spend.ts — §5.5 atomic spend reservation.
 *
 * reserveSpend runs the single-SQL conditional upsert from spec §5.5:
 *
 *   INSERT INTO llm_spend_daily (account_id, date, kind, cents)
 *     VALUES ($account, $date, $kind, $est)
 *     ON CONFLICT (account_id, date, kind)
 *     DO UPDATE SET cents = llm_spend_daily.cents + EXCLUDED.cents
 *     WHERE llm_spend_daily.cents + EXCLUDED.cents <= $cap
 *     RETURNING cents;
 *
 * No row returned → cap exceeded. Single statement = race-free (Postgres
 * serializes the conditional DO UPDATE with its implicit row lock).
 *
 * Per-visit hard ceilings (spec §5.5):
 *   visit 5¢, cluster_label 3¢, embedding 0¢, probe 0¢.
 * The caller MUST pass est_cents ≤ KIND_CEILING[kind]. No silent clamping
 * is applied here; an over-ceiling value will simply allow a spend row
 * larger than the per-kind ceiling (caller bug, not defender behaviour).
 */

import type postgres from 'postgres';

export type SpendKind = 'visit' | 'embedding' | 'cluster_label' | 'probe';

/**
 * Hard per-kind est_cents ceilings from spec §5.5.
 * Callers MUST cap est_cents to these values before calling reserveSpend.
 * Exported so callers can apply the ceiling without duplicating the values.
 */
export const KIND_CEILING: Readonly<Record<SpendKind, number>> = {
  visit: 5,
  cluster_label: 3,
  embedding: 0,
  probe: 0,
} as const;

export type ReserveSpendInput = {
  sql: ReturnType<typeof postgres>;
  account_id: bigint;
  /** ISO date string e.g. '2099-01-01'. */
  date: string;
  kind: SpendKind;
  /**
   * Estimated cents to reserve. Caller MUST apply the per-kind hard ceiling
   * before calling (visit=5¢, cluster_label=3¢, embedding=0¢, probe=0¢ per
   * spec §5.5). No clamping is performed here; see KIND_CEILING for the
   * canonical ceiling values to apply at the call site.
   */
  est_cents: number;
  daily_cap_cents: number;
};

export type ReserveSpendResult =
  // ledger_row_id is intentionally null: llm_spend_daily has no surrogate
  // PK (the composite key (account_id, date, kind) is the identity). Typed
  // as the null literal so callers can't accidentally branch on a non-null
  // value that will never arrive.
  | { ok: true; ledger_row_id: null }
  | { ok: false; reason: 'cap_exceeded' };

/**
 * Atomically reserve est_cents on llm_spend_daily.
 * Returns ok:true when reserved; ok:false when the cap would be exceeded.
 *
 * The SQL WHERE clause on the DO UPDATE ensures the increment only applies
 * when the new total ≤ daily_cap. If the WHERE fails, Postgres returns zero
 * rows (no error) — that is our signal for cap_exceeded.
 *
 * Embeddings (est_cents=0) always succeed and write a row for observability
 * without debiting the cap (spec §5.5).
 */
export async function reserveSpend(input: ReserveSpendInput): Promise<ReserveSpendResult> {
  const { sql, account_id, date, kind, daily_cap_cents, est_cents } = input;

  // Embeddings cost 0¢ — write row for observability, never debit cap.
  if (est_cents === 0) {
    await sql`
      INSERT INTO llm_spend_daily (account_id, date, kind, cents)
        VALUES (${String(account_id)}, ${date}, ${kind}, 0)
        ON CONFLICT (account_id, date, kind) DO NOTHING
    `;
    return { ok: true, ledger_row_id: null };
  }

  const rows = await sql<{ cents: number }[]>`
    INSERT INTO llm_spend_daily (account_id, date, kind, cents)
      VALUES (${String(account_id)}, ${date}, ${kind}, ${est_cents})
      ON CONFLICT (account_id, date, kind)
      DO UPDATE SET cents = llm_spend_daily.cents + EXCLUDED.cents
      WHERE llm_spend_daily.cents + EXCLUDED.cents <= ${daily_cap_cents}
      RETURNING cents
  `;

  if (rows.length === 0) {
    return { ok: false, reason: 'cap_exceeded' };
  }

  return { ok: true, ledger_row_id: null };
}
