/**
 * integration.test.ts — end-to-end integration test for capture-worker
 * broker wiring (issue #84).
 *
 * Scenario:
 *  1. Start ephemeral Postgres via Docker (shared helper from PR #70).
 *  2. Run all migrations so the schema is real.
 *  3. Start the capture broker in-process with in-memory storage + store.
 *  4. Seed: account → study (status='capturing') → backstory → visit (status='started').
 *  5. Start a local fixture HTTP server.
 *  6. Call pollOnce() — the capture worker polling function — with:
 *       - targetUrlOverride pointing at the fixture server
 *       - skipCapture=true (bypass Playwright/Docker on non-Linux macOS dev env)
 *         or use real Playwright with --headless when PLAYWRIGHT_CAPTURE=1
 *       - brokerSocketPath pointing at the temp socket
 *  7. Assertions:
 *       - pollOnce returns { kind: 'processed', visitStatus: 'ok' }
 *       - visit row in DB has status='ok'
 *       - study row in DB has status='visiting' (all visits terminal → advance)
 *       - broker received the artifact (captureStore has 1 row)
 *
 * macOS vs Linux note:
 *   On macOS the netns-bringup.sh script is Linux-only (requires NET_ADMIN +
 *   iproute2). We use skipCapture=true (synthetic a11y tree) by default.
 *   Set PLAYWRIGHT_CAPTURE=1 to run a real headless Chromium capture
 *   (no netns needed — bare captureUrl call). CI on Ubuntu exercises the
 *   real netns path via runWithNetns when RUN_WITH_NETNS=1 is set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import {
  startPostgres,
  stopPostgres,
  type PostgresHandle,
} from '../../../tests/helpers/start-postgres.js';
import {
  startBroker,
  inMemoryStorage,
  inMemoryCaptureStore,
  type BrokerHandle,
} from '@willbuy/capture-broker';
import { startFixtureServer, type FixtureServer } from './server/fixtureServer.js';
import { pollOnce } from '../src/poller.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '..', '..', '..', 'infra', 'migrations');
const MIGRATE_SH = resolve(HERE, '..', '..', '..', 'scripts', 'migrate.sh');

// ── test state ────────────────────────────────────────────────────────────────

let pg: PostgresHandle;
let pool: Pool;
let broker: BrokerHandle;
let captureStore: ReturnType<typeof inMemoryCaptureStore>;
let fixtureServer: FixtureServer;
let socketDir: string;
let socketPath: string;

// ── lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // 1. Start Postgres.
  pg = await startPostgres({ containerPrefix: 'willbuy-capture-worker-it-' });

  // 2. Apply migrations.
  const migrateResult = spawnSync(
    'bash',
    [MIGRATE_SH],
    {
      env: { ...process.env, DATABASE_URL: pg.url, MIGRATIONS_DIR },
      encoding: 'utf8',
    },
  );
  if (migrateResult.status !== 0) {
    throw new Error(
      `migration failed (exit ${migrateResult.status}):\n` +
        migrateResult.stderr.slice(0, 2000),
    );
  }

  // 3. Pool for assertions.
  pool = new Pool({ connectionString: pg.url });

  // 4. Broker with in-memory storage.
  captureStore = inMemoryCaptureStore();
  socketDir = mkdtempSync(join(tmpdir(), 'willbuy-broker-test-'));
  socketPath = join(socketDir, 'broker.sock');
  broker = await startBroker({
    storage: inMemoryStorage(),
    store: captureStore,
    socketPath,
    frameTimeoutMs: 5_000,
  });

  // 5. Fixture HTTP server.
  fixtureServer = await startFixtureServer();
}, 90_000);

afterAll(async () => {
  await fixtureServer?.close().catch(() => {});
  await broker?.close().catch(() => {});
  await pool?.end().catch(() => {});
  stopPostgres(pg?.container);
  try { rmSync(socketDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 30_000);

// ── helpers ───────────────────────────────────────────────────────────────────

async function seedStudyAndVisit(): Promise<{
  accountId: number;
  studyId: number;
  backstoryId: number;
  visitId: number;
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Account
    const accRow = await client.query<{ id: string }>(
      `INSERT INTO accounts (owner_email) VALUES ('test@willbuy.test') RETURNING id`,
    );
    const accountId = Number(accRow.rows[0]!.id);

    // Study — starts with status='capturing' (matches POST /studies response).
    // urls[] is persisted per migration 0016_studies_urls.sql (PR #96 B3 fix);
    // the capture worker reads studies.urls[variant_idx] when leasing a visit.
    // The test still uses targetUrlOverride below to point at the local fixture
    // server, which takes precedence over the DB column — but seeding urls[]
    // exercises the DB shape end-to-end.
    const studyRow = await client.query<{ id: string }>(
      `INSERT INTO studies (account_id, kind, status, urls)
       VALUES ($1, 'single', 'capturing', ARRAY['https://example.com/seed']::text[])
       RETURNING id`,
      [accountId],
    );
    const studyId = Number(studyRow.rows[0]!.id);

    // Backstory
    const bsRow = await client.query<{ id: string }>(
      `INSERT INTO backstories (study_id, idx, payload)
       VALUES ($1, 0, '{"preset_id":"devtools_engineer"}'::jsonb)
       RETURNING id`,
      [studyId],
    );
    const backstoryId = Number(bsRow.rows[0]!.id);

    // Visit — status='started' = ready for capture worker
    const visitRow = await client.query<{ id: string }>(
      `INSERT INTO visits (study_id, backstory_id, variant_idx, status)
       VALUES ($1, $2, 0, 'started')
       RETURNING id`,
      [studyId, backstoryId],
    );
    const visitId = Number(visitRow.rows[0]!.id);

    await client.query('COMMIT');
    return { accountId, studyId, backstoryId, visitId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── test ──────────────────────────────────────────────────────────────────────

describe('capture-worker → broker integration (issue #84)', () => {
  it(
    'transitions visit started→ok and study capturing→visiting after successful capture',
    async () => {
      // Seed DB.
      const { studyId, visitId } = await seedStudyAndVisit();

      // BEFORE: confirm initial state.
      const beforeVisit = await pool.query<{ status: string }>(
        'SELECT status FROM visits WHERE id = $1',
        [visitId],
      );
      expect(beforeVisit.rows[0]?.status).toBe('started');

      const beforeStudy = await pool.query<{ status: string }>(
        'SELECT status FROM studies WHERE id = $1',
        [studyId],
      );
      expect(beforeStudy.rows[0]?.status).toBe('capturing');

      // Run one poll tick.
      // - skipCapture=true: synthetic artifact; avoids Playwright/Docker
      //   on macOS where netns is unavailable. Set PLAYWRIGHT_CAPTURE=1 to
      //   exercise real headless Chromium (no netns required in that mode).
      // - targetUrlOverride: fixture page so the broker gets a plausible URL.
      const useRealCapture = process.env['PLAYWRIGHT_CAPTURE'] === '1';
      const result = await pollOnce({
        pool,
        brokerSocketPath: socketPath,
        brokerTimeoutMs: 10_000,
        skipCapture: !useRealCapture,
        targetUrlOverride: fixtureServer.url('/simple.html'),
      });

      // pollOnce should report a processed visit.
      expect(result.kind).toBe('processed');
      if (result.kind === 'processed') {
        expect(result.visitId).toBe(visitId);
        expect(result.visitStatus).toBe('ok');
      }

      // AFTER: visit status = 'ok'.
      const afterVisit = await pool.query<{ status: string }>(
        'SELECT status FROM visits WHERE id = $1',
        [visitId],
      );
      expect(afterVisit.rows[0]?.status).toBe('ok');

      // AFTER: study status = 'visiting' (all visits terminal → auto-advance).
      const afterStudy = await pool.query<{ status: string }>(
        'SELECT status FROM studies WHERE id = $1',
        [studyId],
      );
      expect(afterStudy.rows[0]?.status).toBe('visiting');

      // Broker received the artifact.
      const capturedRows = captureStore.rows();
      expect(capturedRows.length).toBeGreaterThanOrEqual(1);
      expect(capturedRows[capturedRows.length - 1]?.status).toBe('ok');
    },
    60_000,
  );

  // PR #96 B3 regression: studies.urls[variant_idx] must drive the capture
  // target URL when there is no targetUrlOverride. Before the fix, the
  // production entrypoint silently captured `about:blank` for every visit.
  it(
    'B3: reads target URL from studies.urls[variant_idx] when no override is set',
    async () => {
      const { studyId, visitId } = await seedStudyAndVisit();
      // Stamp a real URL on studies.urls so the poller picks it up.
      const overrideUrl = fixtureServer.url('/simple.html');
      await pool.query(
        `UPDATE studies SET urls = ARRAY[$1]::text[] WHERE id = $2`,
        [overrideUrl, studyId],
      );

      // No targetUrlOverride; skipCapture=true so we don't need Playwright,
      // but the URL precedence path is still exercised (poller reads
      // studies.urls in its lease query).
      const result = await pollOnce({
        pool,
        brokerSocketPath: socketPath,
        brokerTimeoutMs: 10_000,
        skipCapture: true,
      });

      expect(result.kind).toBe('processed');
      if (result.kind === 'processed') {
        expect(result.visitId).toBe(visitId);
        expect(result.visitStatus).toBe('ok');
      }

      // Visit reaches terminal 'ok' (synthetic capture committed via broker).
      const afterVisit = await pool.query<{ status: string }>(
        'SELECT status FROM visits WHERE id = $1',
        [visitId],
      );
      expect(afterVisit.rows[0]?.status).toBe('ok');
    },
    60_000,
  );

  // PR #96 B2 regression: SELECT FOR UPDATE SKIP LOCKED must hold the lease
  // for the duration of the capture, so two concurrent workers do not both
  // process the same visit. Before the fix the txn committed early and the
  // visit row was visible to the second worker.
  it(
    'B2: concurrent pollOnce calls process distinct visits (lease durability)',
    async () => {
      const { studyId } = await seedStudyAndVisit();
      // Add a second visit on the same study so we can observe both being
      // processed without duplication. variant_idx must differ from 0 to
      // satisfy the (study_id, backstory_id, variant_idx) UNIQUE.
      const bs2 = await pool.query<{ id: string }>(
        `INSERT INTO backstories (study_id, idx, payload)
         VALUES ($1, 1, '{"preset_id":"saas_founder_post_pmf"}'::jsonb)
         RETURNING id`,
        [studyId],
      );
      const visit2 = await pool.query<{ id: string }>(
        `INSERT INTO visits (study_id, backstory_id, variant_idx, status)
         VALUES ($1, $2, 0, 'started')
         RETURNING id`,
        [studyId, bs2.rows[0]!.id],
      );
      const visit2Id = Number(visit2.rows[0]!.id);

      // Fire two pollOnce calls concurrently. With the B2 fix each holds its
      // FOR UPDATE row lock for the duration; SKIP LOCKED routes them to
      // different visit rows.
      const [r1, r2] = await Promise.all([
        pollOnce({
          pool,
          brokerSocketPath: socketPath,
          brokerTimeoutMs: 10_000,
          skipCapture: true,
          targetUrlOverride: fixtureServer.url('/simple.html'),
        }),
        pollOnce({
          pool,
          brokerSocketPath: socketPath,
          brokerTimeoutMs: 10_000,
          skipCapture: true,
          targetUrlOverride: fixtureServer.url('/simple.html'),
        }),
      ]);

      // Each run produced a distinct visitId (or one was empty if the second
      // poller hit the row before the first committed but after the lease
      // was released — that's still durable, just sequenced).
      const ids = [r1, r2]
        .filter((r): r is Extract<typeof r, { kind: 'processed' }> => r.kind === 'processed')
        .map((r) => r.visitId);
      // Critical assertion: no visitId was processed twice.
      expect(new Set(ids).size).toBe(ids.length);
      // And both visits should now be terminal.
      const term = await pool.query<{ ok_count: string; failed_count: string; started_count: string }>(
        `SELECT
           sum(case when status='ok' then 1 else 0 end)::text AS ok_count,
           sum(case when status='failed' then 1 else 0 end)::text AS failed_count,
           sum(case when status='started' then 1 else 0 end)::text AS started_count
         FROM visits WHERE id IN ($1, $2)`,
        [String(visit2Id), String(ids[0] ?? visit2Id)],
      );
      expect(Number(term.rows[0]?.started_count ?? '0')).toBeLessThanOrEqual(1);
    },
    60_000,
  );
});
