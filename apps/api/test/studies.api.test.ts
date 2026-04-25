/**
 * studies.api.test.ts — TDD acceptance tests for issue #30.
 *
 * Real-DB integration: spins up a Postgres 16 container via Docker, applies
 * all migrations, seeds data, runs Fastify in-process via app.inject().
 *
 * Spec refs: §5.1, §2 #1, §5.11, §2 #18, §5.12.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';

import { buildServer } from '../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const migrationsDir = resolve(repoRoot, 'infra/migrations');

// --- Docker helpers (same pattern as tests/migrations.test.ts) ---

const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
const dockerAvailable = dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

const PG_IMAGE = 'postgres:16-alpine';
const PG_PASSWORD = 'willbuy_test_pw';
const CONTAINER_PREFIX = 'willbuy-api-test-';

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function dockerRun(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function findFreePort(): number {
  return 30000 + Math.floor(Math.random() * 30000);
}

async function startPostgres(): Promise<{ container: string; port: number; url: string }> {
  const container = CONTAINER_PREFIX + uid();
  let port = findFreePort();
  let attempts = 0;
  let started = false;
  let lastErr = '';
  while (attempts < 3 && !started) {
    const r = dockerRun([
      'run', '-d', '--rm', '--name', container,
      '-e', `POSTGRES_PASSWORD=${PG_PASSWORD}`,
      '-p', `${port}:5432`,
      PG_IMAGE,
    ]);
    if (r.code === 0) {
      started = true;
    } else {
      lastErr = r.stderr;
      port = findFreePort();
      attempts += 1;
    }
  }
  if (!started) throw new Error(`failed to start postgres container: ${lastErr}`);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const r = dockerRun(['exec', container, 'pg_isready', '-U', 'postgres']);
    if (r.code === 0) {
      return { container, port, url: `postgres://postgres:${PG_PASSWORD}@127.0.0.1:${port}/postgres` };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  dockerRun(['rm', '-f', container]);
  throw new Error('postgres container did not become ready in 30s');
}

async function applyMigrations(url: string): Promise<void> {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

// sha256 hex of a string — same as what the API key middleware uses.
function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// --- Test suite ---

describeIfDocker('studies + reports API (issue #30, real DB)', () => {
  let container = '';
  let dbUrl = '';
  let app: FastifyInstance;
  let accountId: bigint;
  let otherAccountId: bigint;
  const apiKey = 'sk_live_testkey_valid_12345678';
  const otherApiKey = 'sk_live_testkey_other_12345678';
  const dailyCapCents = 10_000; // $100/day cap for tests

  beforeAll(async () => {
    const pg = await startPostgres();
    container = pg.container;
    dbUrl = pg.url;

    await applyMigrations(dbUrl);

    // Seed test data.
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      // Account 1 — verified domain example.com, sufficient credits.
      const acc1 = await client.query<{ id: bigint }>(
        `INSERT INTO accounts (owner_email) VALUES ('test@example.com') RETURNING id`,
      );
      accountId = acc1.rows[0]!.id;

      // Add verified_domains column if not present (added by our migration).
      // The column is added in our 0012 migration; check it exists.
      await client.query(
        `INSERT INTO api_keys (account_id, key_hash, prefix) VALUES ($1, $2, $3)`,
        [String(accountId), sha256hex(apiKey), 'sk_live_te'],
      );

      // Give account 1 enough credits: 10000 cents = $100.
      await client.query(
        `INSERT INTO credit_ledger (account_id, kind, cents, idempotency_key)
         VALUES ($1, 'top_up', 10000, $2)`,
        [String(accountId), `test-topup-${uid()}`],
      );

      // Account 2 — for cross-account 404 test.
      const acc2 = await client.query<{ id: bigint }>(
        `INSERT INTO accounts (owner_email) VALUES ('other@example.com') RETURNING id`,
      );
      otherAccountId = acc2.rows[0]!.id;

      await client.query(
        `INSERT INTO api_keys (account_id, key_hash, prefix) VALUES ($1, $2, $3)`,
        [String(otherAccountId), sha256hex(otherApiKey), 'sk_live_ot'],
      );
    } finally {
      await client.end();
    }

    app = await buildServer({
      env: {
        PORT: 0,
        LOG_LEVEL: 'silent',
        URL_HASH_SALT: 'x'.repeat(32),
        DATABASE_URL: dbUrl,
        DAILY_CAP_CENTS: dailyCapCents,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (container) dockerRun(['rm', '-f', container]);
  });

  // --- Acceptance #4: missing/invalid API key → 401 ---
  it('401 when Authorization header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/studies',
      payload: { urls: ['https://example.com'], icp: { preset_id: 'saas_founder_pre_pmf' }, n_visits: 5 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 when API key is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/studies',
      headers: { Authorization: 'Bearer sk_live_notavalidkey' },
      payload: { urls: ['https://example.com'], icp: { preset_id: 'saas_founder_pre_pmf' }, n_visits: 5 },
    });
    expect(res.statusCode).toBe(401);
  });

  // --- Acceptance #6: 3 URLs → 422 (paired A/B = exactly 2 URLs in v0.1) ---
  it('422 when 3 URLs are submitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/studies',
      headers: { Authorization: `Bearer ${apiKey}` },
      payload: {
        urls: ['https://example.com', 'https://example.com/b', 'https://example.com/c'],
        icp: { preset_id: 'saas_founder_pre_pmf' },
        n_visits: 5,
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 when 0 URLs are submitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/studies',
      headers: { Authorization: `Bearer ${apiKey}` },
      payload: {
        urls: [],
        icp: { preset_id: 'saas_founder_pre_pmf' },
        n_visits: 5,
      },
    });
    expect(res.statusCode).toBe(422);
  });

  // --- Acceptance #2: unverified domain → 422 with clear message ---
  it('422 with message when URL domain is not in verified_domains', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/studies',
      headers: { Authorization: `Bearer ${apiKey}` },
      payload: {
        urls: ['https://notverified.io/pricing'],
        icp: { preset_id: 'saas_founder_pre_pmf' },
        n_visits: 5,
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/unverified domain/i);
    expect(body.error).toContain('notverified.io');
  });

  // --- Acceptance #1: happy path → 201 with study_id ---
  it('201 with study_id on happy path (single URL, verified domain)', async () => {
    // First add example.com to the account's verified_domains.
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      await client.query(
        `UPDATE accounts SET verified_domains = ARRAY['example.com'] WHERE id = $1`,
        [String(accountId)],
      );
    } finally {
      await client.end();
    }

    const res = await app.inject({
      method: 'POST',
      url: '/studies',
      headers: { Authorization: `Bearer ${apiKey}` },
      payload: {
        urls: ['https://example.com/pricing'],
        icp: { preset_id: 'saas_founder_pre_pmf' },
        n_visits: 5,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { study_id: string | number; status: string };
    expect(body.study_id).toBeDefined();
    expect(body.status).toBe('capturing');
  });

  it('201 with study_id on happy path (paired A/B = 2 URLs)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/studies',
      headers: { Authorization: `Bearer ${apiKey}` },
      payload: {
        urls: ['https://example.com/pricing', 'https://example.com/pricing-v2'],
        icp: { preset_id: 'saas_founder_pre_pmf' },
        n_visits: 5,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { study_id: string | number; status: string };
    expect(body.study_id).toBeDefined();
    expect(body.status).toBe('capturing');
  });

  // --- Acceptance #3: cap exceeded → 402, no study row, no provider_attempts row ---
  it('402 when daily cap is exceeded, no study row created', async () => {
    // Seed account at 99% of cap.
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    let capAccount: bigint;
    const capApiKey = 'sk_live_captest_key_12345678';
    try {
      const acc = await client.query<{ id: bigint }>(
        `INSERT INTO accounts (owner_email, verified_domains) VALUES ('cap@example.com', ARRAY['example.com']) RETURNING id`,
      );
      capAccount = acc.rows[0]!.id;
      await client.query(
        `INSERT INTO api_keys (account_id, key_hash, prefix) VALUES ($1, $2, $3)`,
        [String(capAccount), sha256hex(capApiKey), 'sk_live_ca'],
      );
      // Give credits.
      await client.query(
        `INSERT INTO credit_ledger (account_id, kind, cents, idempotency_key)
         VALUES ($1, 'top_up', 10000, $2)`,
        [String(capAccount), `cap-topup-${uid()}`],
      );
      // Seed llm_spend_daily at 99% of the daily cap (9900 out of 10000 cents).
      // The study request is n_visits=50, 1 URL → 1×50×5¢ + 3¢ = 253¢. 9900 + 253 = 10153 > 10000 → 402.
      await client.query(
        `INSERT INTO llm_spend_daily (account_id, date, kind, cents)
         VALUES ($1, CURRENT_DATE, 'visit', $2)`,
        [String(capAccount), Math.floor(dailyCapCents * 0.99)],
      );
    } finally {
      await client.end();
    }

    // n_visits=50, 1 URL → 1×50×5¢ + 3¢ = 253¢; 9900 + 253 = 10153 > 10000 → 402.
    const res = await app.inject({
      method: 'POST',
      url: '/studies',
      headers: { Authorization: `Bearer ${capApiKey}` },
      payload: {
        urls: ['https://example.com/pricing'],
        icp: { preset_id: 'saas_founder_pre_pmf' },
        n_visits: 50,
      },
    });
    expect(res.statusCode).toBe(402);

    // Verify no study row was created for this account.
    const client2 = new Client({ connectionString: dbUrl });
    await client2.connect();
    try {
      const rows = await client2.query<{ count: string }>(
        `SELECT count(*) AS count FROM studies WHERE account_id = $1`,
        [String(capAccount)],
      );
      expect(rows.rows[0]!.count).toBe('0');
    } finally {
      await client2.end();
    }
  });

  // --- Acceptance #5: GET /studies/:id own study → 200; other → 404 ---
  it('GET /studies/:id returns 200 for own study and 404 for another account', async () => {
    // Create a study for account 1 first.
    const createRes = await app.inject({
      method: 'POST',
      url: '/studies',
      headers: { Authorization: `Bearer ${apiKey}` },
      payload: {
        urls: ['https://example.com/pricing'],
        icp: { preset_id: 'saas_founder_pre_pmf' },
        n_visits: 5,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { study_id: number };
    const studyId = created.study_id;

    // Own account — should get 200.
    const ownRes = await app.inject({
      method: 'GET',
      url: `/studies/${studyId}`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(ownRes.statusCode).toBe(200);
    const ownBody = ownRes.json() as {
      id: number;
      status: string;
      visit_progress: { ok: number; failed: number; total: number };
      started_at: string;
      finalized_at: string | null;
    };
    expect(ownBody.id).toBe(studyId);
    expect(ownBody.status).toBe('capturing');
    expect(ownBody.visit_progress.total).toBe(5);
    expect(ownBody.started_at).toBeDefined();

    // Other account — should get 404 (not 403, per spec §2 #1).
    const otherRes = await app.inject({
      method: 'GET',
      url: `/studies/${studyId}`,
      headers: { Authorization: `Bearer ${otherApiKey}` },
    });
    expect(otherRes.statusCode).toBe(404);
  });

  // --- Acceptance #7: GET /reports/:slug happy path ---
  it('GET /reports/:slug returns report payload with valid share token', async () => {
    // Insert a report directly (aggregator normally creates this).
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    let studyId: bigint;
    const shareToken = 'validtoken12345678901'; // 21 chars nanoid-style
    const tokenHash = sha256hex(shareToken);
    try {
      // Create a study.
      const s = await client.query<{ id: bigint }>(
        `INSERT INTO studies (account_id, kind, status)
         VALUES ($1, 'single', 'ready') RETURNING id`,
        [String(accountId)],
      );
      studyId = s.rows[0]!.id;

      // Create a report with a share_token_hash.
      await client.query(
        `INSERT INTO reports
           (study_id, share_token_hash, conv_score, paired_delta_json, public)
         VALUES ($1, $2, 0.5, '{}', false)`,
        [String(studyId), tokenHash],
      );
    } finally {
      await client.end();
    }

    // Access without token — should 404 (not public, token required).
    const noTokenRes = await app.inject({
      method: 'GET',
      url: `/reports/${String(studyId)}`,
    });
    expect(noTokenRes.statusCode).toBe(404);

    // Access with valid token — should 200.
    const withTokenRes = await app.inject({
      method: 'GET',
      url: `/reports/${String(studyId)}?t=${shareToken}`,
    });
    expect(withTokenRes.statusCode).toBe(200);
    const body = withTokenRes.json() as {
      study_id: number;
      conv_score: number;
      paired_delta_json: object;
    };
    expect(body.study_id).toBeDefined();
    expect(typeof body.conv_score).toBe('number');
  });

  it('404 when report is expired (§2 #20 — no existence leak)', async () => {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    let studyId: bigint;
    const shareToken = 'expiredtoken123456789';
    const tokenHash = sha256hex(shareToken);
    try {
      const s = await client.query<{ id: bigint }>(
        `INSERT INTO studies (account_id, kind, status)
         VALUES ($1, 'single', 'ready') RETURNING id`,
        [String(accountId)],
      );
      studyId = s.rows[0]!.id;

      await client.query(
        `INSERT INTO reports
           (study_id, share_token_hash, conv_score, paired_delta_json, public,
            expires_at)
         VALUES ($1, $2, 0.5, '{}', false, NOW() - INTERVAL '1 second')`,
        [String(studyId), tokenHash],
      );
    } finally {
      await client.end();
    }

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${String(studyId)}?t=${shareToken}`,
    });
    expect(res.statusCode).toBe(404);
  });
});
