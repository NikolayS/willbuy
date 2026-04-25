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
 * The caller's est_cents is already capped to the per-kind ceiling before
 * calling here; we enforce the ceiling here as well for defence-in-depth.
 */

import type postgres from 'postgres';

export type SpendKind = 'visit' | 'embedding' | 'cluster_label' | 'probe';

/** Hard per-kind est_cents ceilings from spec §5.5. */
const KIND_CEILING: Record<SpendKind, number> = {
  visit: 5,
  cluster_label: 3,
  embedding: 0,
  probe: 0,
};

export type ReserveSpendInput = {
  sql: ReturnType<typeof postgres>;
  account_id: bigint;
  /** ISO date string e.g. '2099-01-01'. */
  date: string;
  kind: SpendKind;
  /** Estimated cents to reserve. Clamped to KIND_CEILING[kind] internally. */
  est_cents: number;
  daily_cap_cents: number;
};

export type ReserveSpendResult =
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
 * See spec §5.5 and the cap_warnings note about the 50% gate; the 50% gate
 * is a SEPARATE call to maybeWarnCap in cap-warning.ts.
 */
export async function reserveSpend(input: ReserveSpendInput): Promise<ReserveSpendResult> {
  const { sql, account_id, date, kind, daily_cap_cents } = input;

  // Enforce per-kind ceiling
  const ceiling = KIND_CEILING[kind];
  const est_cents = Math.min(input.est_cents, ceiling);

  // Embeddings cost 0¢ — they still write a row for observability but never
  // debit the cap (spec §5.5). We skip the cap-check for 0¢ kinds.
  if (est_cents === 0) {
    // Upsert without the cap WHERE so zero-cost calls always succeed.
    await sql`
      INSERT INTO llm_spend_daily (account_id, date, kind, cents)
        VALUES (${String(account_id)}, ${date}, ${kind}, 0)
        ON CONFLICT (account_id, date, kind) DO NOTHING
    `;
    return { ok: true, ledger_row_id: null };
  }

  const rows = await sql<[{ cents: number }?]>`
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
