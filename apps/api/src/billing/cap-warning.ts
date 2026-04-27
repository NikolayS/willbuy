/**
 * cap-warning.ts — §5.6 cap-warning email exactly-once.
 *
 * maybeWarnCap: called AFTER a successful reserveSpend with the post-reserve
 * total (new_cents). If new_cents has crossed 50% of daily_cap, attempts to
 * insert a cap_warnings row. The PRIMARY KEY (account_id, date, kind) on
 * cap_warnings is the exactly-once gate — Postgres will reject duplicate
 * inserts with a unique_violation, so only one concurrent caller succeeds.
 *
 * Returns true when this caller was the one that inserted the warning row
 * (i.e., the email was dispatched). Returns false when the row already
 * existed (another caller beat us, or the 50% threshold hasn't been crossed).
 */

import type postgres from 'postgres';
import type { ResendClient } from '../email/resend.js';

export type MaybeWarnCapInput = {
  sql: ReturnType<typeof postgres>;
  account_id: bigint;
  /** ISO date string. */
  date: string;
  /** The new total cents after a successful reserve (from RETURNING cents). */
  new_cents: number;
  daily_cap_cents: number;
  /** Account owner email — recipient of the cap-warning email. */
  owner_email: string;
  /** The study that pushed spend over the threshold. */
  study_id: string;
  /** Resend client for sending the warning email. */
  resend: ResendClient;
};

/**
 * If new_cents ≥ 50% of daily_cap_cents and no warning has been sent yet for
 * this (account_id, date, 'cap_50_warning'), insert a cap_warnings row and
 * return true (caller should send the email).
 *
 * Uses INSERT … ON CONFLICT DO NOTHING with a RETURNING clause:
 * exactly one concurrent caller gets a row back; others get zero rows.
 *
 * The cap_warnings table has PRIMARY KEY (account_id, date, kind) per
 * migration 0008_llm_spend_daily.sql — that is our exactly-once gate.
 */
export async function maybeWarnCap(input: MaybeWarnCapInput): Promise<boolean> {
  const { sql, account_id, date, new_cents, daily_cap_cents, owner_email, study_id, resend } = input;

  if (new_cents < daily_cap_cents * 0.5) {
    return false;
  }

  // Attempt the race-free insert. ON CONFLICT DO NOTHING means exactly one
  // concurrent caller gets a RETURNING row; others get an empty result set.
  const rows = await sql`
    INSERT INTO cap_warnings (account_id, date, kind, sent_at)
    VALUES (${String(account_id)}, ${date}, 'cap_50_warning', now())
    ON CONFLICT (account_id, date, kind) DO NOTHING
    RETURNING account_id
  `;

  if (rows.length === 0) {
    return false;
  }

  // This caller won the race — send the warning email (spec §5.6).
  // cap_warning_sent_at (the INSERT above) is committed first so idempotency
  // holds even if the send fails. We log errors but do not throw — a missed
  // email is recoverable; propagating the error here would break the study
  // creation response.
  try {
    await resend.sendCapWarning({
      to: owner_email,
      account_id: String(account_id),
      current_cents: new_cents,
      cap_cents: daily_cap_cents,
      study_id,
    });
  } catch (err) {
    console.error('[cap-warning] sendCapWarning failed (non-fatal):', err);
  }

  return true;
}

// Test seam — not part of the public API surface.
export const __test__ = {
  /** Pure threshold predicate — true when warning should be considered (new_cents ≥ 50% of cap). */
  exceedsHalfCap: (newCents: number, dailyCapCents: number): boolean =>
    newCents >= dailyCapCents * 0.5,
};
