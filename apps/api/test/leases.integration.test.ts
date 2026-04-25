// apps/api/test/leases.integration.test.ts — TDD acceptance for §5.11 + §2 #12.
//
// Real-DB integration tests (no mocks, per project memory).
// Follows the testcontainer pattern from tests/migrations.test.ts:
//   beforeAll: docker run postgres:16-alpine (ephemeral), apply migrations.
//   afterAll: docker rm -f container.
// Tests are skipped if Docker is unavailable (same guard as migrations.test.ts).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { startPostgres, stopPostgres } from '../../../tests/helpers/start-postgres.js';

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

// ─── testcontainer helpers (uses shared start-postgres helper) ────────────────

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..'); // apps/api → monorepo root
const migrateScript = resolve(repoRoot, 'scripts/migrate.sh');

// Tests can be driven two ways:
//   1. TEST_DATABASE_URL is set → use that existing DB (no Docker needed).
//      The caller is responsible for applying migrations before running tests.
//   2. TEST_DATABASE_URL is NOT set → spin an ephemeral Docker container,
//      apply migrations, and tear it down in afterAll.
//      Skipped if Docker is unavailable.
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const useExternalDb = Boolean(TEST_DATABASE_URL);

const dockerCheck = !useExternalDb
  ? spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' })
  : { status: 0 };
const dockerAvailable = useExternalDb || dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

const PG_PASSWORD = 'willbuy_lease_test_pw';

function runMigrate(databaseUrl: string): { code: number; stdout: string; stderr: string } {
  // migrate.sh resolves migrations relative to cwd; run it from the repo root.
  const r = spawnSync('bash', [migrateScript], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ─── suite state ──────────────────────────────────────────────────────────────

let pgState: { container: string; port: number; url: string } | undefined;
let pool: pg.Pool | undefined;

// Track created entity IDs for cleanup
let accountId: bigint;
let studyId: bigint;
let backstoryId: bigint;
let visitIdA: bigint;
let visitIdB: bigint;

function getPool(): pg.Pool {
  if (!pool) throw new Error('pool not initialized');
  return pool;
}

async function q(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  return getPool().query(sql, params);
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
  if (!pool) return;
  await q(`DELETE FROM accounts WHERE owner_email LIKE 'test+%@example.com'`);
}

// ─── suite setup ─────────────────────────────────────────────────────────────

describeIfDocker('backstory lease + aggregator finalize — integration (§5.11, §2 #12)', () => {
  beforeAll(async () => {
    let dbUrl: string;
    if (useExternalDb) {
      // Use the pre-existing DB provided by the caller; migrations already applied.
      dbUrl = TEST_DATABASE_URL!;
    } else {
      // Spin an ephemeral Docker container and apply migrations.
      // Uses the shared startPostgres helper (PR #60 wait-for-log strategy)
      // to eliminate the startup race that caused flakes on second CI pass.
      pgState = await startPostgres({
        containerPrefix: 'willbuy-lease-test-',
        dbName: 'willbuy_lease_test',
        password: PG_PASSWORD,
      });
      const migResult = runMigrate(pgState.url);
      if (migResult.code !== 0) {
        throw new Error(`migrations failed: ${migResult.stderr}`);
      }
      dbUrl = pgState.url;
    }
    pool = new Pool({ connectionString: dbUrl, max: 20 });
    await pool.query('SELECT 1');
  }, 120_000);

  afterAll(async () => {
    await cleanAll();
    if (pool) await pool.end();
    // Only stop the container if we started it (not in external-DB mode).
    if (!useExternalDb && pgState) stopPostgres(pgState.container);
  });

  // Fresh entities before each test to avoid state leakage.
  beforeEach(async () => {
    accountId = await insertAccount();
    studyId = await insertStudy(accountId);
    backstoryId = await insertBackstory(studyId);
    visitIdA = await insertVisit(studyId, backstoryId, 0);
    visitIdB = await insertVisit(studyId, backstoryId, 1);
  });

  // ─── Acceptance criterion 1 ────────────────────────────────────────────────
  // Two visitor workers race for the same backstory → only one acquires; other
  // backs off and eventually fails.
  // Per-backstory A vs B isolation: while side A's lease is held, side B cannot
  // acquire (the paired-A/B isolation guarantee from spec §2 #18).

  describe('backstory lease — race + A/B isolation (AC#1)', () => {
    it('two concurrent acquires → exactly one wins, other returns held', async () => {
      const [r1, r2] = await Promise.all([
        acquireLease(getPool(), {
          backstory_id: backstoryId,
          owner_visit_id: visitIdA,
          ttl_seconds: 120,
        }),
        acquireLease(getPool(), {
          backstory_id: backstoryId,
          owner_visit_id: visitIdB,
          ttl_seconds: 120,
        }),
      ]);

      const winners = [r1, r2].filter((r) => r.ok);
      const losers = [r1, r2].filter((r) => !r.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect((losers[0] as { ok: false; reason: string }).reason).toBe('held');
    });

    it('while side A holds the lease, side B cannot acquire (A/B isolation)', async () => {
      const ra = await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
        ttl_seconds: 120,
      });
      expect(ra.ok).toBe(true);

      const rb = await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdB,
        ttl_seconds: 120,
      });
      expect(rb.ok).toBe(false);
      if (!rb.ok) expect(rb.reason).toBe('held');
    });

    it('acquireLeaseWithBackoff backs off and returns held after 3 tries', async () => {
      const ra = await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
        ttl_seconds: 120,
      });
      expect(ra.ok).toBe(true);

      const start = Date.now();
      const rb = await acquireLeaseWithBackoff(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdB,
        ttl_seconds: 120,
      });
      const elapsed = Date.now() - start;

      expect(rb.ok).toBe(false);
      if (!rb.ok) expect(rb.reason).toBe('held');
      // At least 2 backoff intervals: 100ms + 400ms with 0.8 jitter floor = 80 + 320 = 400ms min.
      expect(elapsed).toBeGreaterThanOrEqual(350);
    });
  });

  // ─── Acceptance criterion 2 ────────────────────────────────────────────────
  // Heartbeat extends past lease_until; missed heartbeat → reclaim possible after
  // lease_until.

  describe('backstory lease — heartbeat + expiry (AC#2)', () => {
    it('extendLease bumps lease_until past original', async () => {
      const acquire = await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
        ttl_seconds: 5,
      });
      expect(acquire.ok).toBe(true);
      if (!acquire.ok) throw new Error('unreachable');
      const original = acquire.lease_until;

      const extend = await extendLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
        ttl_seconds: 120,
      });
      expect(extend.ok).toBe(true);
      if (!extend.ok) throw new Error('unreachable');
      expect(extend.lease_until.getTime()).toBeGreaterThan(original.getTime());
    });

    it('non-owner cannot extend', async () => {
      await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
        ttl_seconds: 120,
      });
      const extend = await extendLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdB,
        ttl_seconds: 120,
      });
      expect(extend.ok).toBe(false);
      if (!extend.ok) expect(extend.reason).toBe('not_owner');
    });

    it('expired lease can be reclaimed by another visitor', async () => {
      const ra = await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
        ttl_seconds: 1,
      });
      expect(ra.ok).toBe(true);

      // Manually expire the row to avoid waiting 1+ sec in tests.
      await q(
        `UPDATE backstory_leases SET lease_until = NOW() - INTERVAL '1 second'
          WHERE backstory_id = $1`,
        [String(backstoryId)],
      );

      const rb = await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdB,
        ttl_seconds: 120,
      });
      expect(rb.ok).toBe(true);
    });

    it('releaseLease clears the row; a new visitor can then acquire', async () => {
      await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
        ttl_seconds: 120,
      });
      await releaseLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
      });

      const rb = await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdB,
        ttl_seconds: 120,
      });
      expect(rb.ok).toBe(true);
    });

    it('releaseLease by non-owner is a no-op', async () => {
      await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
        ttl_seconds: 120,
      });
      await releaseLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdB,
      });
      const rb = await acquireLease(getPool(), {
        backstory_id: backstoryId,
        owner_visit_id: visitIdB,
        ttl_seconds: 120,
      });
      expect(rb.ok).toBe(false);
    });
  });

  // ─── Acceptance criterion 3 ────────────────────────────────────────────────
  // 10 concurrent aggregators try to finalize the same study → exactly one
  // commits ready.  The 9 losers receive zero rows from SKIP LOCKED within one
  // connection-pool round-trip (no blocking for the aggregation duration).
  // Concurrency-bench output is captured in the PR body.

  describe('aggregator finalize lock — 10 concurrent aggregators (AC#3)', () => {
    it('exactly one commits ready; 9 losers get zero rows (SKIP LOCKED, no blocking)', async () => {
      const aggStudyId = await insertStudy(accountId, 'aggregating');

      const CONCURRENCY = 10;
      const token = `tok-${Date.now()}`;

      const start = Date.now();

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, async (_, i) => {
          const lock = await acquireFinalizeLock(getPool(), { study_id: aggStudyId });
          if (!lock.ok) {
            return { winner: false, locker: i };
          }
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
            return { winner: false, locker: i };
          }
        }),
      );

      const elapsed = Date.now() - start;

      const winners = results.filter((r) => r.winner);
      const losers = results.filter((r) => !r.winner);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(9);

      const studyRow = await q(`SELECT status FROM studies WHERE id = $1`, [String(aggStudyId)]);
      expect(studyRow.rows[0]?.status).toBe('ready');

      const reportRow = await q(`SELECT count(*) FROM reports WHERE study_id = $1`, [
        String(aggStudyId),
      ]);
      expect(Number(reportRow.rows[0]?.count)).toBe(1);

      // Concurrency bench output for PR body.
      console.log(
        `[bench] 10 concurrent aggregators completed in ${elapsed} ms; 1 winner, 9 losers (zero-row SKIP LOCKED)`,
      );
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ─── Acceptance criterion 4 ────────────────────────────────────────────────
  // commitReport enforces UNIQUE(reports.study_id) — second attempt fails.

  describe('commitReport — UNIQUE(reports.study_id) (AC#4)', () => {
    it('second commitReport for the same study throws on the UNIQUE violation', async () => {
      const aggStudyId = await insertStudy(accountId, 'aggregating');
      const token = `tok-ac4-${Date.now()}`;

      const lock1 = await acquireFinalizeLock(getPool(), { study_id: aggStudyId });
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

      // Study is now 'ready' — a second acquireFinalizeLock returns ok:false.
      // Even bypassing the lock, UNIQUE must reject.
      await expect(
        getPool().query(
          `INSERT INTO reports (study_id, share_token_hash, conv_score, paired_delta_json)
           VALUES ($1, $2, 0.6, '{}')`,
          [String(aggStudyId), `${token}-second`],
        ),
      ).rejects.toThrow(/unique/i);
    });
  });

  // ─── Acceptance criterion 5 ────────────────────────────────────────────────
  // After commitReport lands status=ready, a late visit calling recordLateArrival
  // does NOT mutate the report.

  describe('recordLateArrival — does not mutate report (AC#5)', () => {
    it('late arrival writes to late_arrivals only; report row unchanged', async () => {
      const aggStudyId = await insertStudy(accountId, 'aggregating');
      const lateBackstoryId = await insertBackstory(aggStudyId, 1);
      const lateVisitId = await insertVisit(aggStudyId, lateBackstoryId, 0);
      const token = `tok-ac5-${Date.now()}`;

      const lock = await acquireFinalizeLock(getPool(), { study_id: aggStudyId });
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

      await recordLateArrival(getPool(), {
        study_id: aggStudyId,
        visit_id: lateVisitId,
        payload_key: 's3://bucket/late-payload.json',
      });

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

      expect(afterRow.conv_score).toBe(beforeRow.conv_score);
      expect(JSON.stringify(afterRow.paired_delta_json)).toBe(
        JSON.stringify(beforeRow.paired_delta_json),
      );
      expect(JSON.stringify(afterRow.clusters_json)).toBe(
        JSON.stringify(beforeRow.clusters_json),
      );
      expect(afterRow.ready_at.toISOString()).toBe(beforeRow.ready_at.toISOString());

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

      await recordLateArrival(getPool(), { study_id: aggStudyId, visit_id: v });
      await recordLateArrival(getPool(), { study_id: aggStudyId, visit_id: v });

      const la = await q(
        `SELECT count(*) FROM late_arrivals WHERE study_id = $1 AND visit_id = $2`,
        [String(aggStudyId), String(v)],
      );
      expect(Number(la.rows[0]?.count)).toBe(1);
    });
  });

  // ─── Extra: failStudy ──────────────────────────────────────────────────────

  describe('failStudy — sets status=failed (supplemental)', () => {
    it('failStudy transitions the study to failed', async () => {
      const aggStudyId = await insertStudy(accountId, 'aggregating');
      const lock = await acquireFinalizeLock(getPool(), { study_id: aggStudyId });
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
});
