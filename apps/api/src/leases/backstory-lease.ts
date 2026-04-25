// apps/api/src/leases/backstory-lease.ts — per-backstory lease (spec §2 #12, §5.11).
//
// Schema contract (infra/migrations/0004_backstories_and_leases.sql + 0005_visits.sql):
//   backstory_leases(backstory_id PK FK→backstories, study_id, holder_visit_id FK→visits,
//                    lease_until TIMESTAMPTZ, heartbeat_at TIMESTAMPTZ)
//
// Paired-A/B isolation (spec §2 #18): a single lease row per backstory means
// side-A and side-B visits cannot be in flight simultaneously — one holds the
// row, the other gets 'held'. Released on terminal visit commit OR lease_until
// expiry (whoever comes first), which is the definition in §5.11.
//
// Backoff: 100 ms → 400 ms → 1.6 s jittered, 3 tries → caller failure (spec §2 S2-6).
// SKIP LOCKED rationale recorded in §5.11 (v0.5 amendment); the lock is an
// optimisation for spend/compute economy; correctness comes from unique constraints.

import type { Pool, PoolClient } from 'pg';

export interface AcquireLeaseInput {
  backstory_id: bigint | number;
  owner_visit_id: bigint | number;
  ttl_seconds: number;
}

export type AcquireLeaseResult =
  | { ok: true; lease_until: Date }
  | { ok: false; reason: 'held' };

export interface ReleaseLeaseInput {
  backstory_id: bigint | number;
  owner_visit_id: bigint | number;
}

export interface ExtendLeaseInput {
  backstory_id: bigint | number;
  owner_visit_id: bigint | number;
  ttl_seconds: number;
}

export type ExtendLeaseResult =
  | { ok: true; lease_until: Date }
  | { ok: false; reason: 'not_owner' | 'not_found' };

// Jittered exponential backoff: 100 ms → 400 ms → 1.6 s with ±20% jitter.
// 3 tries maximum before returning failure to caller.
const BACKOFF_BASE_MS = 100;
const BACKOFF_FACTOR = 4;
const BACKOFF_MAX_TRIES = 3;

function jitter(ms: number): number {
  // ±20% uniform jitter
  return ms * (0.8 + Math.random() * 0.4);
}

function backoffMs(attempt: number): number {
  // attempt is 0-indexed
  return jitter(BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, attempt));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// acquireLease — single-SQL conditional INSERT/UPDATE to claim the lease.
// Returns the lease_until if the caller now holds the lease, or
// { ok: false, reason: 'held' } if another visitor currently holds it.
//
// Implementation: INSERT ... ON CONFLICT (backstory_id) DO UPDATE with a
// predicate that only allows the update when the existing lease is expired.
// This is atomic in Postgres — the PK lock on backstory_id serialises
// concurrent acquisitions so exactly one writer wins per backstory.
//
// The UPDATE path fires only when EXCLUDED.holder_visit_id differs from the
// current holder AND the current lease_until < NOW() (expired).
// If the row is live (lease_until >= NOW()) the DO UPDATE sets nothing and
// we check whether we became the holder by comparing holder_visit_id in the
// RETURNING clause.
export async function acquireLease(
  pool: Pool,
  input: AcquireLeaseInput,
): Promise<AcquireLeaseResult> {
  const { backstory_id, owner_visit_id, ttl_seconds } = input;

  // Step 1: Upsert the lease row.
  //   - If no row exists → INSERT and win.
  //   - If a row exists and is expired → UPDATE (reclaim) and win.
  //   - If a row exists and is live → DO UPDATE is a no-op (condition false);
  //     the RETURNING clause still returns the row so we can check ownership.
  //
  // We use INSERT ... ON CONFLICT DO UPDATE with a WHERE clause on the
  // conflict target row.  The WHERE clause makes the UPDATE conditional:
  // only fires when lease_until < NOW() (expired).  When it doesn't fire,
  // Postgres still returns the row (the existing live row) because we alias
  // the no-op update as SET heartbeat_at = heartbeat_at.
  //
  // Actually: ON CONFLICT DO UPDATE WHERE fires the update only when the
  // condition is true; but if the condition is false, Postgres does nothing
  // and returns nothing.  So we need a different approach.
  //
  // Best atomic approach: use a transaction with FOR UPDATE + conditional logic.
  // This avoids the ON CONFLICT / CTE snapshot issue entirely.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the existing row (if any) or nothing. FOR UPDATE SKIP LOCKED
    // would skip if another transaction holds it; we want to WAIT here
    // (we're the lease-acquire path, not the aggregator path).
    // Plain FOR UPDATE blocks until any concurrent write releases.
    const existing = await client.query<{
      holder_visit_id: string;
      lease_until: Date;
    }>(
      `SELECT holder_visit_id, lease_until
         FROM backstory_leases
        WHERE backstory_id = $1
        FOR UPDATE`,
      [String(backstory_id)],
    );

    const now = new Date();
    const row = existing.rows[0];

    if (row === undefined) {
      // No lease row — insert and win.
      const ins = await client.query<{ lease_until: Date }>(
        `INSERT INTO backstory_leases
           (backstory_id, study_id, holder_visit_id, lease_until, heartbeat_at)
         SELECT b.id, b.study_id, $2::bigint,
                NOW() + ($3::int * INTERVAL '1 second'), NOW()
           FROM backstories b
          WHERE b.id = $1
         RETURNING lease_until`,
        [String(backstory_id), String(owner_visit_id), ttl_seconds],
      );
      await client.query('COMMIT');
      const insRow = ins.rows[0];
      if (insRow === undefined) {
        return { ok: false, reason: 'held' };
      }
      return { ok: true, lease_until: insRow.lease_until };
    }

    if (row.lease_until <= now) {
      // Expired lease — reclaim it.
      const upd = await client.query<{ lease_until: Date }>(
        `UPDATE backstory_leases
            SET holder_visit_id = $2::bigint,
                lease_until     = NOW() + ($3::int * INTERVAL '1 second'),
                heartbeat_at    = NOW()
          WHERE backstory_id = $1
         RETURNING lease_until`,
        [String(backstory_id), String(owner_visit_id), ttl_seconds],
      );
      await client.query('COMMIT');
      const updRow = upd.rows[0];
      if (updRow === undefined) {
        return { ok: false, reason: 'held' };
      }
      return { ok: true, lease_until: updRow.lease_until };
    }

    // Lease is live and held by someone else.
    await client.query('ROLLBACK');
    return { ok: false, reason: 'held' };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

// releaseLease — clears the lease row only if caller is the current holder.
// No-op (no error) if the lease is already gone or held by another visit.
export async function releaseLease(pool: Pool, input: ReleaseLeaseInput): Promise<void> {
  const { backstory_id, owner_visit_id } = input;
  await pool.query(
    `DELETE FROM backstory_leases
      WHERE backstory_id = $1
        AND holder_visit_id = $2`,
    [String(backstory_id), String(owner_visit_id)],
  );
}

// extendLease — heartbeat: extend lease_until by ttl_seconds from NOW().
// Only the current owner can extend. Returns ok:false + reason if not owner
// or lease has already expired/been reclaimed.
export async function extendLease(pool: Pool, input: ExtendLeaseInput): Promise<ExtendLeaseResult> {
  const { backstory_id, owner_visit_id, ttl_seconds } = input;

  const result = await pool.query<{ lease_until: Date }>(
    `UPDATE backstory_leases
        SET lease_until   = NOW() + ($3::int * INTERVAL '1 second'),
            heartbeat_at  = NOW()
      WHERE backstory_id      = $1
        AND holder_visit_id   = $2
      RETURNING lease_until`,
    [String(backstory_id), String(owner_visit_id), ttl_seconds],
  );

  const row = result.rows[0];
  if (row === undefined) {
    // Either lease doesn't exist or caller isn't the owner.
    const existing = await pool.query<{ holder_visit_id: string }>(
      `SELECT holder_visit_id FROM backstory_leases WHERE backstory_id = $1`,
      [String(backstory_id)],
    );
    if (existing.rowCount === 0) {
      return { ok: false, reason: 'not_found' };
    }
    return { ok: false, reason: 'not_owner' };
  }

  return { ok: true, lease_until: row.lease_until };
}

// acquireLeaseWithBackoff — wraps acquireLease with jittered exponential
// backoff (spec §2 S2-6): 100 ms → 400 ms → 1.6 s, 3 tries max.
// Returns the same AcquireLeaseResult as acquireLease; after exhausting
// retries returns { ok: false, reason: 'held' }.
export async function acquireLeaseWithBackoff(
  pool: Pool,
  input: AcquireLeaseInput,
): Promise<AcquireLeaseResult> {
  for (let attempt = 0; attempt < BACKOFF_MAX_TRIES; attempt++) {
    const result = await acquireLease(pool, input);
    if (result.ok) {
      return result;
    }
    // Last attempt — don't sleep, just return
    if (attempt < BACKOFF_MAX_TRIES - 1) {
      await sleep(backoffMs(attempt));
    }
  }
  return { ok: false, reason: 'held' };
}

// Pool client accessor type — the pool owns the lifecycle; callers provide
// a pool, not a raw client, so the lease functions don't need to manage
// client checkout/release themselves for simple single-statement work.
// For transactional sequences the caller provides a PoolClient directly.
export type { Pool, PoolClient };
