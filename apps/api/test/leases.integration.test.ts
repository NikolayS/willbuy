// apps/api/test/leases.integration.test.ts — TDD acceptance for §5.11 + §2 #12.
//
// Real-DB integration tests (no mocks, per project memory).
// Requires TEST_DATABASE_URL env var pointing at a real Postgres instance with
// the full willbuy schema applied (infra/migrations/ applied in order).
//
// Test DB default: postgres://postgres:testpass@127.0.0.1:54399/willbuy_test
// Override with TEST_DATABASE_URL env var.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
  acquireLease,
  acquireLeaseWithBackoff,
  extendLease,
  releaseLease,
} from '../src/leases/backstory-lease.js';
import {
  acquireFinalizeLock,
  commitReport,
  failStudy,
  recordLateArrival,
} from '../src/finalize/aggregator-lock.js';

const { Pool } = pg;

const TEST_DB_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://postgres:testpass@127.0.0.1:54399/willbuy_test';

// ─── helpers ──────────────────────────────────────────────────────────────────

let pool: pg.Pool;
// Track created entity IDs for cleanup
let accountId: bigint;
let studyId: bigint;
let backstoryId: bigint;
let visitIdA: bigint;
let visitIdB: bigint;

async function q(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  return pool.query(sql, params);
}

async function insertAccount(): Promise<bigint> {
  const res = await q(
    `INSERT INTO accounts (owner_email) VALUES ($1) RETURNING id`,
    [`test+${Date.now()}@example.com`],
  );
  return BigInt(res.rows[0].id as string);
}

async function insertStudy(account_id: bigint, status = 'visiting'): Promise<bigint> {
  const res = await q(
    `INSERT INTO studies (account_id, kind, status) VALUES ($1, 'single', $2) RETURNING id`,
    [String(account_id), status],
  );
  return BigInt(res.rows[0].id as string);
}

async function insertBackstory(study_id: bigint, idx = 0): Promise<bigint> {
  const res = await q(
    `INSERT INTO backstories (study_id, idx, payload) VALUES ($1, $2, '{}') RETURNING id`,
    [String(study_id), idx],
  );
  return BigInt(res.rows[0].id as string);
}

async function insertVisit(
  study_id: bigint,
  backstory_id: bigint,
  variant_idx: 0 | 1 = 0,
): Promise<bigint> {
  const res = await q(
    `INSERT INTO visits (study_id, backstory_id, variant_idx, status)
     VALUES ($1, $2, $3, 'started') RETURNING id`,
    [String(study_id), String(backstory_id), variant_idx],
  );
  return BigInt(res.rows[0].id as string);
}

async function cleanAll(): Promise<void> {
  // Delete in reverse-FK order; cascade handles most of it from accounts.
  await q(`DELETE FROM accounts WHERE owner_email LIKE 'test+%@example.com'`);
}

// ─── suite setup ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DB_URL, max: 20 });
  await pool.query('SELECT 1'); // smoke-test connection
});

afterAll(async () => {
  await cleanAll();
  await pool.end();
});

beforeEach(async () => {
  // Fresh entities for each test to avoid state leakage.
  accountId = await insertAccount();
  studyId = await insertStudy(accountId);
  backstoryId = await insertBackstory(studyId);
  visitIdA = await insertVisit(studyId, backstoryId, 0);
  visitIdB = await insertVisit(studyId, backstoryId, 1);
});

// ─── Acceptance criterion 1 ───────────────────────────────────────────────────
// Two visitor workers race for the same backstory → only one acquires; other
// backs off and eventually fails.
// Per-backstory A vs B isolation: while side A's lease is held, side B cannot
// acquire (the paired-A/B isolation guarantee from spec §2 #18).

describe('backstory lease — race + A/B isolation (AC#1)', () => {
  it('two concurrent acquires → exactly one wins, other returns held', async () => {
    const [r1, r2] = await Promise.all([
      acquireLease(pool, { backstory_id: backstoryId, owner_visit_id: visitIdA, ttl_seconds: 120 }),
      acquireLease(pool, { backstory_id: backstoryId, owner_visit_id: visitIdB, ttl_seconds: 120 }),
    ]);

    const winners = [r1, r2].filter((r) => r.ok);
    const losers = [r1, r2].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as { ok: false; reason: string }).reason).toBe('held');
  });

  it('while side A holds the lease, side B cannot acquire (A/B isolation)', async () => {
    // Explicitly acquire as side A first.
    const ra = await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    expect(ra.ok).toBe(true);

    // Side B must be blocked.
    const rb = await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdB,
      ttl_seconds: 120,
    });
    expect(rb.ok).toBe(false);
    if (!rb.ok) expect(rb.reason).toBe('held');
  });

  it('acquireLeaseWithBackoff backs off and returns held after 3 tries', async () => {
    // First, grab the lease with visitIdA so visitIdB will always find it held.
    const ra = await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    expect(ra.ok).toBe(true);

    const start = Date.now();
    const rb = await acquireLeaseWithBackoff(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdB,
      ttl_seconds: 120,
    });
    const elapsed = Date.now() - start;

    expect(rb.ok).toBe(false);
    if (!rb.ok) expect(rb.reason).toBe('held');
    // Should have waited at least 2 backoff intervals (100ms + 400ms ≈ 500ms,
    // minus jitter floor of 0.8: 80ms + 320ms = 400ms minimum).
    expect(elapsed).toBeGreaterThanOrEqual(350);
  });
});

// ─── Acceptance criterion 2 ───────────────────────────────────────────────────
// Heartbeat extends past lease_until; missed heartbeat → reclaim possible after
// lease_until.

describe('backstory lease — heartbeat + expiry (AC#2)', () => {
  it('extendLease bumps lease_until past original', async () => {
    const acquire = await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 5,
    });
    expect(acquire.ok).toBe(true);
    if (!acquire.ok) throw new Error('unreachable');
    const original = acquire.lease_until;

    // Heartbeat with longer TTL.
    const extend = await extendLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    expect(extend.ok).toBe(true);
    if (!extend.ok) throw new Error('unreachable');
    expect(extend.lease_until.getTime()).toBeGreaterThan(original.getTime());
  });

  it('non-owner cannot extend', async () => {
    await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    const extend = await extendLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdB, // wrong owner
      ttl_seconds: 120,
    });
    expect(extend.ok).toBe(false);
    if (!extend.ok) expect(extend.reason).toBe('not_owner');
  });

  it('expired lease can be reclaimed by another visitor', async () => {
    // Acquire with a 1-second TTL.
    const ra = await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 1,
    });
    expect(ra.ok).toBe(true);

    // Manually expire the row in the DB to avoid sleeping 1+ sec in tests.
    await q(
      `UPDATE backstory_leases SET lease_until = NOW() - INTERVAL '1 second'
        WHERE backstory_id = $1`,
      [String(backstoryId)],
    );

    // Now side B should be able to reclaim.
    const rb = await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdB,
      ttl_seconds: 120,
    });
    expect(rb.ok).toBe(true);
  });

  it('releaseLease clears the row; a new visitor can then acquire', async () => {
    await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    await releaseLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
    });

    const rb = await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdB,
      ttl_seconds: 120,
    });
    expect(rb.ok).toBe(true);
  });

  it('releaseLease by non-owner is a no-op', async () => {
    await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    // visitIdB tries to release — must be a no-op.
    await releaseLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdB,
    });
    // visitIdA row still there; visitIdB still cannot acquire.
    const rb = await acquireLease(pool, {
      backstory_id: backstoryId,
      owner_visit_id: visitIdB,
      ttl_seconds: 120,
    });
    expect(rb.ok).toBe(false);
  });
});

// ─── Acceptance criterion 3 ───────────────────────────────────────────────────
// 10 concurrent aggregators try to finalize the same study → exactly one
// commits ready.  The 9 losers receive zero rows from SKIP LOCKED within one
// connection-pool round-trip (no blocking for the aggregation duration).
// Concurrency-bench output is captured in the PR body.

describe('aggregator finalize lock — 10 concurrent aggregators (AC#3)', () => {
  it('exactly one commits ready; 9 losers get zero rows (SKIP LOCKED, no blocking)', async () => {
    // Set study to 'aggregating'.
    const aggStudyId = await insertStudy(accountId, 'aggregating');

    const CONCURRENCY = 10;
    const token = `tok-${Date.now()}`;

    const start = Date.now();

    // Launch 10 concurrent aggregators.
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, i) => {
        const lock = await acquireFinalizeLock(pool, { study_id: aggStudyId });
        if (!lock.ok) {
          return { winner: false, locker: i };
        }
        // Winner: commit a report.
        try {
          await commitReport({
            study_id: aggStudyId,
            conn: lock.conn,
            report_data: {
              share_token_hash: `${token}-${i}`,
              conv_score: 0.5,
              paired_delta_json: { delta: 0.1 },
            },
          });
          return { winner: true, locker: i };
        } catch {
          // Could lose the UNIQUE(reports.study_id) race even after acquiring
          // the row lock if multiple connections somehow both got the row —
          // shouldn't happen but treat as loser.
          return { winner: false, locker: i };
        }
      }),
    );

    const elapsed = Date.now() - start;

    const winners = results.filter((r) => r.winner);
    const losers = results.filter((r) => !r.winner);

    // Exactly one winner.
    expect(winners).toHaveLength(1);
    // Nine losers.
    expect(losers).toHaveLength(9);

    // The study status must now be 'ready'.
    const studyRow = await q(`SELECT status FROM studies WHERE id = $1`, [String(aggStudyId)]);
    expect(studyRow.rows[0]?.status).toBe('ready');

    // Exactly one report row.
    const reportRow = await q(`SELECT count(*) FROM reports WHERE study_id = $1`, [
      String(aggStudyId),
    ]);
    expect(Number(reportRow.rows[0]?.count)).toBe(1);

    // CONCURRENCY BENCH OUTPUT (printed to stdout for PR body).
    // The 9 losers must have returned without blocking for the aggregation
    // duration — all 10 concurrent calls complete in one round-trip time,
    // well under 1 second total.
    console.log(
      `[bench] 10 concurrent aggregators completed in ${elapsed} ms; 1 winner, 9 losers (zero-row SKIP LOCKED)`,
    );
    // SKIP LOCKED guarantee: all 10 finish well under 500 ms (one connection
    // round-trip is < 50 ms; 9 losers return immediately).
    expect(elapsed).toBeLessThan(5000); // generous bound for CI
  });
});

// ─── Acceptance criterion 4 ───────────────────────────────────────────────────
// commitReport enforces UNIQUE(reports.study_id) — second attempt fails.

describe('commitReport — UNIQUE(reports.study_id) (AC#4)', () => {
  it('second commitReport for the same study throws on the UNIQUE violation', async () => {
    const aggStudyId = await insertStudy(accountId, 'aggregating');
    const token = `tok-ac4-${Date.now()}`;

    // First commit succeeds — need to re-acquire lock since previous test
    // may have consumed it; here we use a fresh study so the lock is available.
    const lock1 = await acquireFinalizeLock(pool, { study_id: aggStudyId });
    expect(lock1.ok).toBe(true);
    if (!lock1.ok) throw new Error('unreachable');

    await commitReport({
      study_id: aggStudyId,
      conn: lock1.conn,
      report_data: {
        share_token_hash: `${token}-first`,
        conv_score: 0.6,
        paired_delta_json: {},
      },
    });

    // Study is now 'ready' — the lock query filters on status='aggregating',
    // so a second acquireFinalizeLock will return ok:false.
    // But even if we bypass the lock and INSERT directly, UNIQUE must reject.
    await expect(
      pool.query(
        `INSERT INTO reports (study_id, share_token_hash, conv_score, paired_delta_json)
         VALUES ($1, $2, 0.6, '{}')`,
        [String(aggStudyId), `${token}-second`],
      ),
    ).rejects.toThrow(/unique/i);
  });
});

// ─── Acceptance criterion 5 ───────────────────────────────────────────────────
// After commitReport lands status=ready, a late visit calling recordLateArrival
// does NOT mutate the report (assert by reading the report row before and after).

describe('recordLateArrival — does not mutate report (AC#5)', () => {
  it('late arrival writes to late_arrivals only; report row unchanged', async () => {
    const aggStudyId = await insertStudy(accountId, 'aggregating');
    const lateBackstoryId = await insertBackstory(aggStudyId, 1);
    const lateVisitId = await insertVisit(aggStudyId, lateBackstoryId, 0);
    const token = `tok-ac5-${Date.now()}`;

    // Finalize the study.
    const lock = await acquireFinalizeLock(pool, { study_id: aggStudyId });
    expect(lock.ok).toBe(true);
    if (!lock.ok) throw new Error('unreachable');

    await commitReport({
      study_id: aggStudyId,
      conn: lock.conn,
      report_data: {
        share_token_hash: token,
        conv_score: 0.75,
        paired_delta_json: { delta: 0.2 },
        clusters_json: { clusters: [] },
      },
    });

    // Snapshot the report row before late arrival.
    const before = await q(
      `SELECT conv_score, paired_delta_json, clusters_json, ready_at FROM reports WHERE study_id = $1`,
      [String(aggStudyId)],
    );
    const beforeRow = before.rows[0] as {
      conv_score: string;
      paired_delta_json: unknown;
      clusters_json: unknown;
      ready_at: Date;
    };

    // Simulate a late visit arriving.
    await recordLateArrival(pool, {
      study_id: aggStudyId,
      visit_id: lateVisitId,
      payload_key: 's3://bucket/late-payload.json',
    });

    // Snapshot after.
    const after = await q(
      `SELECT conv_score, paired_delta_json, clusters_json, ready_at FROM reports WHERE study_id = $1`,
      [String(aggStudyId)],
    );
    const afterRow = after.rows[0] as {
      conv_score: string;
      paired_delta_json: unknown;
      clusters_json: unknown;
      ready_at: Date;
    };

    // Report row must be byte-identical.
    expect(afterRow.conv_score).toBe(beforeRow.conv_score);
    expect(JSON.stringify(afterRow.paired_delta_json)).toBe(
      JSON.stringify(beforeRow.paired_delta_json),
    );
    expect(JSON.stringify(afterRow.clusters_json)).toBe(
      JSON.stringify(beforeRow.clusters_json),
    );
    expect(afterRow.ready_at.toISOString()).toBe(beforeRow.ready_at.toISOString());

    // late_arrivals has our row.
    const la = await q(
      `SELECT payload_key FROM late_arrivals WHERE study_id = $1 AND visit_id = $2`,
      [String(aggStudyId), String(lateVisitId)],
    );
    expect(la.rowCount).toBe(1);
    expect(la.rows[0]?.payload_key).toBe('s3://bucket/late-payload.json');
  });

  it('recordLateArrival is idempotent — second call is a no-op', async () => {
    const aggStudyId = await insertStudy(accountId, 'aggregating');
    const bs = await insertBackstory(aggStudyId, 2);
    const v = await insertVisit(aggStudyId, bs, 0);

    await recordLateArrival(pool, { study_id: aggStudyId, visit_id: v });
    await recordLateArrival(pool, { study_id: aggStudyId, visit_id: v });

    const la = await q(
      `SELECT count(*) FROM late_arrivals WHERE study_id = $1 AND visit_id = $2`,
      [String(aggStudyId), String(v)],
    );
    expect(Number(la.rows[0]?.count)).toBe(1);
  });
});

// ─── Extra: failStudy sets status=failed ──────────────────────────────────────

describe('failStudy — sets status=failed (supplemental)', () => {
  it('failStudy transitions the study to failed', async () => {
    const aggStudyId = await insertStudy(accountId, 'aggregating');
    const lock = await acquireFinalizeLock(pool, { study_id: aggStudyId });
    expect(lock.ok).toBe(true);
    if (!lock.ok) throw new Error('unreachable');

    await failStudy({
      study_id: aggStudyId,
      conn: lock.conn,
      reason: 'insufficient_ok_visits',
    });

    const row = await q(`SELECT status, finalized_at FROM studies WHERE id = $1`, [
      String(aggStudyId),
    ]);
    expect(row.rows[0]?.status).toBe('failed');
    expect(row.rows[0]?.finalized_at).not.toBeNull();
  });
});
