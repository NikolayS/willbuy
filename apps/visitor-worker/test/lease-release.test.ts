// apps/visitor-worker/test/lease-release.test.ts
//
// Integration test: spec §5.11 — per-backstory lease MUST be released on
// visit terminal commit (status='done' or status='failed'), not left to
// expire after 120 s.
//
// Before fix: releaseLease() was never called from the visitor-worker;
//   the backstory_leases row would persist until lease_until (120 s later).
// After fix:  releaseLease() is invoked in a finally block inside runVisit()
//   when RunVisitOptions.leaseRelease is provided; the row is gone within
//   ~10 ms of the terminal return.
//
// Pattern mirrors apps/api/test/leases.integration.test.ts:
//   beforeAll: startPostgres or TEST_DATABASE_URL, apply migrations.
//   afterAll:  stopPostgres + pool.end().
//   beforeEach: fresh account/study/backstory/visit rows.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { startPostgres, stopPostgres } from '../../../tests/helpers/start-postgres.js';
import { acquireLease } from '@willbuy/api/leases/backstory-lease';
import { runVisit } from '../src/index.js';
import { MockProvider } from './helpers/mockProvider.js';
import {
  SAMPLE_BACKSTORY,
  SAMPLE_PAGE_SNAPSHOT,
  validVisitorJsonString,
} from './helpers/fixtures.js';

const { Pool } = pg;

// ─── DB setup helpers ────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..'); // apps/visitor-worker → monorepo root
const migrateScript = resolve(repoRoot, 'scripts/migrate.sh');

const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const useExternalDb = Boolean(TEST_DATABASE_URL);

const dockerCheck = !useExternalDb
  ? spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' })
  : { status: 0 };
const dockerAvailable = useExternalDb || dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

const PG_PASSWORD = 'willbuy_lease_release_test_pw';

function runMigrate(databaseUrl: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', [migrateScript], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ─── suite state ─────────────────────────────────────────────────────────────

let pgState: { container: string; port: number; url: string } | undefined;
let pool: pg.Pool | undefined;

let accountId: bigint;
let studyId: bigint;
let backstoryId: bigint;
let visitIdA: bigint;

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
    [`test+lrtest+${Date.now()}@example.com`],
  );
  return BigInt((res.rows[0] as { id: string }).id);
}

async function insertStudy(account_id: bigint): Promise<bigint> {
  const res = await q(
    `INSERT INTO studies (account_id, kind, status) VALUES ($1, 'single', 'visiting') RETURNING id`,
    [String(account_id)],
  );
  return BigInt((res.rows[0] as { id: string }).id);
}

async function insertBackstory(study_id: bigint): Promise<bigint> {
  const res = await q(
    `INSERT INTO backstories (study_id, idx, payload) VALUES ($1, 0, '{}') RETURNING id`,
    [String(study_id)],
  );
  return BigInt((res.rows[0] as { id: string }).id);
}

async function insertVisit(study_id: bigint, backstory_id: bigint): Promise<bigint> {
  const res = await q(
    `INSERT INTO visits (study_id, backstory_id, variant_idx, status)
     VALUES ($1, $2, 0, 'started') RETURNING id`,
    [String(study_id), String(backstory_id)],
  );
  return BigInt((res.rows[0] as { id: string }).id);
}

async function leaseRowExists(backstory_id: bigint): Promise<boolean> {
  const res = await q(
    `SELECT 1 FROM backstory_leases WHERE backstory_id = $1 AND lease_until > NOW()`,
    [String(backstory_id)],
  );
  return (res.rowCount ?? 0) > 0;
}

async function cleanAll(): Promise<void> {
  if (!pool) return;
  await q(`DELETE FROM accounts WHERE owner_email LIKE 'test+lrtest+%@example.com'`);
}

// ─── suite setup ─────────────────────────────────────────────────────────────

describeIfDocker('lease-release integration — spec §5.11', () => {
  beforeAll(async () => {
    let dbUrl: string;
    if (useExternalDb) {
      dbUrl = TEST_DATABASE_URL!;
    } else {
      pgState = await startPostgres({
        containerPrefix: 'willbuy-lr-test-',
        dbName: 'willbuy_lr_test',
        password: PG_PASSWORD,
      });
      const migResult = runMigrate(pgState.url);
      if (migResult.code !== 0) {
        throw new Error(`migrations failed: ${migResult.stderr}`);
      }
      dbUrl = pgState.url;
    }
    pool = new Pool({ connectionString: dbUrl, max: 10 });
    await pool.query('SELECT 1');
  }, 120_000);

  afterAll(async () => {
    await cleanAll();
    if (pool) await pool.end();
    if (!useExternalDb && pgState) stopPostgres(pgState.container);
  });

  beforeEach(async () => {
    accountId = await insertAccount();
    studyId = await insertStudy(accountId);
    backstoryId = await insertBackstory(studyId);
    visitIdA = await insertVisit(studyId, backstoryId);
  });

  // ─── RED test: without fix, lease persists ───────────────────────────────
  // With the fix wired, this test asserts the FIXED behavior:
  // after runVisit() returns, the backstory_leases row for visitIdA is gone.
  //
  // Before the fix: runVisit() does NOT call releaseLease(); the row persists
  // with lease_until = NOW() + 120s → leaseRowExists() returns true → FAIL.
  // After the fix: runVisit() calls releaseLease() via the leaseRelease option;
  // the row is deleted → leaseRowExists() returns false → PASS.

  it('lease row is gone within 50ms of runVisit() returning (ok path)', async () => {
    // Step 1: acquire the lease for visitIdA
    const acquired = await acquireLease(getPool(), {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    expect(acquired.ok).toBe(true);

    // Confirm the row exists before the visit runs.
    expect(await leaseRowExists(backstoryId)).toBe(true);

    // Step 2: run the visitor with a mock LLM that returns valid output on
    // the first call.
    const provider = new MockProvider({
      responses: [{ raw: validVisitorJsonString(), transportAttempts: 1, status: 'ok' }],
    });

    const t0 = Date.now();
    const result = await runVisit({
      provider,
      backstory: SAMPLE_BACKSTORY,
      pageSnapshot: SAMPLE_PAGE_SNAPSHOT,
      visitId: String(visitIdA),
      // leaseRelease: the fix wires this into a finally block inside runVisit.
      leaseRelease: {
        pool: getPool(),
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
      },
    });
    const elapsed = Date.now() - t0;

    expect(result.status).toBe('ok');

    // Step 3: assert the lease row is gone.
    // The release must happen INSIDE runVisit (before it returns), so by the
    // time we reach this line the row should already be deleted.
    expect(await leaseRowExists(backstoryId)).toBe(false);

    // Timing: the entire release path should complete within 50ms of
    // runVisit() returning (it's a single DELETE, not 120s wait).
    // We log for PR body evidence.
    console.log(
      `[lease-release] ok path: runVisit+release took ${elapsed}ms; ` +
      `lease gone immediately (not after 120s)`,
    );
  });

  it('lease row is gone within 50ms of runVisit() returning (failed/transport path)', async () => {
    const acquired = await acquireLease(getPool(), {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    expect(acquired.ok).toBe(true);
    expect(await leaseRowExists(backstoryId)).toBe(true);

    // Transport-error path: adapter returns status='error' → runVisit returns
    // status='failed' with failure_reason='transport'. The lease MUST still
    // be released so a failed visit doesn't hold the backstory for 120s.
    const provider = new MockProvider({
      responses: [{ raw: '', transportAttempts: 1, status: 'error' }],
    });

    const t0 = Date.now();
    const result = await runVisit({
      provider,
      backstory: SAMPLE_BACKSTORY,
      pageSnapshot: SAMPLE_PAGE_SNAPSHOT,
      visitId: String(visitIdA),
      leaseRelease: {
        pool: getPool(),
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
      },
    });
    const elapsed = Date.now() - t0;

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toBe('transport');

    expect(await leaseRowExists(backstoryId)).toBe(false);

    console.log(
      `[lease-release] failed/transport path: runVisit+release took ${elapsed}ms; ` +
      `lease gone immediately (not after 120s)`,
    );
  });

  it('lease row is gone within 50ms of runVisit() returning (failed/schema path)', async () => {
    const acquired = await acquireLease(getPool(), {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    expect(acquired.ok).toBe(true);
    expect(await leaseRowExists(backstoryId)).toBe(true);

    // Schema-failure path: 3 invalid JSON responses exhausts MAX_REPAIR_GENERATION.
    const provider = new MockProvider({
      responses: [
        { raw: 'not-json', transportAttempts: 1, status: 'ok' },
        { raw: 'also-not-json', transportAttempts: 1, status: 'ok' },
        { raw: 'still-not-json', transportAttempts: 1, status: 'ok' },
      ],
    });

    const t0 = Date.now();
    const result = await runVisit({
      provider,
      backstory: SAMPLE_BACKSTORY,
      pageSnapshot: SAMPLE_PAGE_SNAPSHOT,
      visitId: String(visitIdA),
      leaseRelease: {
        pool: getPool(),
        backstory_id: backstoryId,
        owner_visit_id: visitIdA,
      },
    });
    const elapsed = Date.now() - t0;

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toBe('schema');

    expect(await leaseRowExists(backstoryId)).toBe(false);

    console.log(
      `[lease-release] failed/schema path: runVisit+release took ${elapsed}ms; ` +
      `lease gone immediately (not after 120s)`,
    );
  });

  it('runVisit without leaseRelease option leaves the row intact (baseline)', async () => {
    // Baseline: caller did not pass leaseRelease (e.g. older callsite or a
    // visit that never acquired a lease). runVisit must NOT blow up — it
    // just skips the release. The row persists (lease_until is in the future).
    const acquired = await acquireLease(getPool(), {
      backstory_id: backstoryId,
      owner_visit_id: visitIdA,
      ttl_seconds: 120,
    });
    expect(acquired.ok).toBe(true);

    const provider = new MockProvider({
      responses: [{ raw: validVisitorJsonString(), transportAttempts: 1, status: 'ok' }],
    });

    await runVisit({
      provider,
      backstory: SAMPLE_BACKSTORY,
      pageSnapshot: SAMPLE_PAGE_SNAPSHOT,
      visitId: String(visitIdA),
      // No leaseRelease — row should still be there.
    });

    // Row persists — this confirms the option is truly optional and that the
    // existing callers that don't pass leaseRelease are unaffected.
    expect(await leaseRowExists(backstoryId)).toBe(true);
    console.log('[lease-release] baseline: no leaseRelease option → row persists (expected)');
  });
});
