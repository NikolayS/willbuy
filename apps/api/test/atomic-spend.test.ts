/**
 * atomic-spend.test.ts — TDD acceptance suite for issue #28.
 *
 * Tests §5.5 atomic spend reservation, §5.6 cap-warning, §16 provider_attempts.
 * All tests use a REAL database — no mocks (per repo memory note on mock/prod
 * divergence). DB is spun up via docker for each run.
 *
 * Per-test isolation: each test gets a fresh account row + distinct date so
 * rows don't bleed across tests.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { startPostgres, stopPostgres } from '../../../tests/helpers/start-postgres.js';
import { reserveSpend } from '../src/billing/atomic-spend.js';
import { startAttempt, endAttempt } from '../src/billing/provider-attempts.js';
import { maybeWarnCap } from '../src/billing/cap-warning.js';

// ---------------------------------------------------------------------------
// Docker availability guard
// ---------------------------------------------------------------------------

const PG_PASSWORD = 'willbuy_test_pw_28';

const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
const dockerAvailable = dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Repo root (resolved from test file location: apps/api/test/ → ../../..)
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

// ---------------------------------------------------------------------------
// Globals set up in beforeAll
// ---------------------------------------------------------------------------

let sql: ReturnType<typeof postgres>;
let pgPort: number;
let pgContainer: string;

// ---------------------------------------------------------------------------
// Schema bootstrap — applies all real migrations into the test DB
// ---------------------------------------------------------------------------

function applyMigrations(): void {
  const migrateScript = resolve(repoRoot, 'scripts', 'migrate.sh');
  const migrationsDir = resolve(repoRoot, 'infra', 'migrations');
  const r = spawnSync('bash', [migrateScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: `postgres://postgres:${PG_PASSWORD}@127.0.0.1:${pgPort}/postgres`,
      MIGRATIONS_DIR: migrationsDir,
    },
  });
  if (r.status !== 0) {
    throw new Error(`migrate.sh failed: ${r.stderr}\n${r.stdout}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers: insert minimal rows for foreign-key constraints
// ---------------------------------------------------------------------------

let accountSeq = 100_000;

async function newAccount(): Promise<bigint> {
  // Use sql.unsafe to avoid bigint-in-template issues in helpers.
  const rows = await sql.unsafe<{ id: bigint }[]>(
    `INSERT INTO accounts (owner_email, created_at)
     VALUES ($1, now())
     RETURNING id`,
    [`test-${accountSeq++}@example.com`],
  );
  return rows[0]!.id;
}

async function newStudy(accountId: bigint): Promise<bigint> {
  const rows = await sql.unsafe<{ id: bigint }[]>(
    `INSERT INTO studies (account_id, kind, status, created_at)
     VALUES ($1, 'single', 'pending', now())
     RETURNING id`,
    [String(accountId)],
  );
  return rows[0]!.id;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describeIfDocker('atomic spend reservation (§5.5)', () => {
  beforeAll(async () => {
    // Use the shared startPostgres helper (PR #60 wait-for-log strategy) to
    // eliminate the startup race that caused flakes in the second CI pass.
    const pg = await startPostgres({
      containerPrefix: 'willbuy-spend-test-',
      password: PG_PASSWORD,
    });
    pgPort = pg.port;
    pgContainer = pg.container;

    applyMigrations();

    sql = postgres(`postgres://postgres:${PG_PASSWORD}@127.0.0.1:${pgPort}/postgres`, {
      max: 20,
      idle_timeout: 10,
    });
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
    stopPostgres(pgContainer);
  });

  // -------------------------------------------------------------------------
  // AC1: Reserve at 0% → ok, llm_spend_daily updated
  // -------------------------------------------------------------------------
  it('AC1: reserve at 0% → ok, llm_spend_daily row created at est_cents', async () => {
    const accountId = await newAccount();
    const date = '2099-01-01';

    const result = await reserveSpend({
      sql,
      account_id: accountId,
      date,
      kind: 'visit',
      est_cents: 5,
      daily_cap_cents: 1000,
    });

    expect(result.ok).toBe(true);

    const rows = await sql.unsafe<{ cents: number }[]>(
      `SELECT cents FROM llm_spend_daily
       WHERE account_id = $1 AND date = $2 AND kind = 'visit'`,
      [String(accountId), date],
    );
    expect(rows[0]!.cents).toBe(5);
  });

  // -------------------------------------------------------------------------
  // AC2: Fill to cap → ok each time, total equals cap
  // -------------------------------------------------------------------------
  it('AC2: reserve up to cap → ok each time, total equals sum', async () => {
    const accountId = await newAccount();
    const date = '2099-01-02';

    for (let i = 0; i < 10; i++) {
      const r = await reserveSpend({
        sql,
        account_id: accountId,
        date,
        kind: 'visit',
        est_cents: 10,
        daily_cap_cents: 100,
      });
      expect(r.ok).toBe(true);
    }

    const rows = await sql.unsafe<{ cents: number }[]>(
      `SELECT cents FROM llm_spend_daily
       WHERE account_id = $1 AND date = $2 AND kind = 'visit'`,
      [String(accountId), date],
    );
    expect(rows[0]!.cents).toBe(100);
  });

  // -------------------------------------------------------------------------
  // AC3: One more over cap → cap_exceeded, ledger unchanged
  // -------------------------------------------------------------------------
  it('AC3: reserve past cap → cap_exceeded, ledger unchanged', async () => {
    const accountId = await newAccount();
    const date = '2099-01-03';

    await reserveSpend({
      sql,
      account_id: accountId,
      date,
      kind: 'visit',
      est_cents: 100,
      daily_cap_cents: 100,
    });

    const r = await reserveSpend({
      sql,
      account_id: accountId,
      date,
      kind: 'visit',
      est_cents: 1,
      daily_cap_cents: 100,
    });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected cap_exceeded');
    expect(r.reason).toBe('cap_exceeded');

    const rows = await sql.unsafe<{ cents: number }[]>(
      `SELECT cents FROM llm_spend_daily
       WHERE account_id = $1 AND date = $2 AND kind = 'visit'`,
      [String(accountId), date],
    );
    expect(rows[0]!.cents).toBe(100);
  });

  // -------------------------------------------------------------------------
  // AC4: CONCURRENCY — 40 parallel callers at 99.9% of cap → never exceeded
  // -------------------------------------------------------------------------
  it(
    'AC4 (BLOCKING): 40 parallel callers at 99.9% cap → cap never exceeded',
    async () => {
      const accountId = await newAccount();
      const date = '2099-01-04';
      const DAILY_CAP = 1000;

      // Pre-fill to 995/1000 (only 5¢ left — exactly one 5¢ call can fit)
      await reserveSpend({
        sql,
        account_id: accountId,
        date,
        kind: 'visit',
        est_cents: 995,
        daily_cap_cents: DAILY_CAP,
      });

      // 40 concurrent callers each requesting 5¢; only 1 can fit
      const results = await Promise.all(
        Array.from({ length: 40 }, () =>
          reserveSpend({
            sql,
            account_id: accountId,
            date,
            kind: 'visit',
            est_cents: 5,
            daily_cap_cents: DAILY_CAP,
          }),
        ),
      );

      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.filter((r) => !r.ok).length;

      // DB total must never exceed cap
      const rows = await sql.unsafe<{ cents: number }[]>(
        `SELECT cents FROM llm_spend_daily
         WHERE account_id = $1 AND date = $2 AND kind = 'visit'`,
        [String(accountId), date],
      );
      const total = rows[0]!.cents;
      // Emit for PR body paste
      console.log(`[AC4] total_cents=${total} daily_cap=${DAILY_CAP} ok=${okCount} capped=${failCount}`);

      // At most 1 succeeds (only 5¢ room); cap is never exceeded
      expect(okCount).toBeLessThanOrEqual(1);
      expect(failCount).toBeGreaterThanOrEqual(39);
      expect(total).toBeLessThanOrEqual(DAILY_CAP);
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // AC5: cap_warnings UNIQUE — two concurrent 50% crossings → exactly one row
  // -------------------------------------------------------------------------
  it('AC5: concurrent cap_50_warning inserts → exactly one row in cap_warnings', async () => {
    const accountId = await newAccount();
    const date = '2099-01-05';
    const DAILY_CAP = 100;

    // Two concurrent calls both indicate crossing 50%
    const results = await Promise.all([
      maybeWarnCap({
        sql,
        account_id: accountId,
        date,
        new_cents: 51,
        daily_cap_cents: DAILY_CAP,
      }),
      maybeWarnCap({
        sql,
        account_id: accountId,
        date,
        new_cents: 52,
        daily_cap_cents: DAILY_CAP,
      }),
    ]);

    const warningsInserted = results.filter(Boolean).length;
    expect(warningsInserted).toBe(1);

    // DB must have exactly one row
    const rows = await sql.unsafe<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM cap_warnings
       WHERE account_id = $1 AND date = $2 AND kind = 'cap_50_warning'`,
      [String(accountId), date],
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // AC6: provider_attempts row exists BEFORE and AFTER simulated subprocess failure
  // -------------------------------------------------------------------------
  it('AC6: provider_attempts row persists after simulated subprocess failure', async () => {
    const accountId = await newAccount();
    const studyId = await newStudy(accountId);

    const attemptId = await startAttempt({
      sql,
      account_id: accountId,
      study_id: studyId,
      kind: 'visit',
      logical_request_key: `test-lrk-${Date.now()}-${Math.random()}`,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      est_cents: 5,
    });

    // Simulate subprocess failure: verify row exists before any endAttempt call
    const rows = await sql.unsafe<{ id: string; status: string }[]>(
      `SELECT id::text, status FROM provider_attempts WHERE id = $1`,
      [String(attemptId)],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('started');

    // Even if we never call endAttempt, the row persists (committed before the call)
    // Clean up for DB hygiene
    await endAttempt({ sql, id: attemptId, status: 'ended', actual_cents: 0 });

    const rows2 = await sql.unsafe<{ status: string }[]>(
      `SELECT status FROM provider_attempts WHERE id = $1`,
      [String(attemptId)],
    );
    expect(rows2[0]!.status).toBe('ended');
  });
});
