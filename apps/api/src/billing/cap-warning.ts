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
 * (i.e., should enqueue the email). Returns false when the row already
 * existed (another caller beat us, or the 50% threshold hasn't been crossed).
 *
 * Email sending is stubbed — TODO wire Resend when it's available.
 */

import type postgres from 'postgres';

export type MaybeWarnCapInput = {
  sql: ReturnType<typeof postgres>;
  account_id: bigint;
  /** ISO date string. */
  date: string;
  /** The new total cents after a successful reserve (from RETURNING cents). */
  new_cents: number;
  daily_cap_cents: number;
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
  const { sql, account_id, date, new_cents, daily_cap_cents } = input;

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

  // This caller won the race — enqueue the warning email.
  // TODO: wire Resend transactional email here once available (spec §5.6).
  // await resend.emails.send({ to: account.owner_email, subject: '50% cap warning', ... });

  return true;
}
