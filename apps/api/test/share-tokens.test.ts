/**
 * share-tokens.test.ts — TDD acceptance tests for issue #487.
 *
 * Spec refs: §2 #20 (share-token minting), §5.12 (share-token cookie redirect).
 *
 * Real-DB integration: spins up a Postgres 16 container via Docker, applies
 * all migrations, seeds data, runs Fastify in-process via app.inject().
 *
 * POST /api/studies/:id/share-token
 *   - 201: valid session + owned study with report → returns { token, url, expires_at }
 *   - 401: no session
 *   - 404: study exists but no report row yet
 *   - 404: study not owned by caller
 *   - 409: non-revoked, non-expired share token already exists for this report_slug
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';

import { startPostgres, stopPostgres } from '../../../tests/helpers/start-postgres.js';
import { buildServer } from '../src/server.js';
import { encodeSession } from '../src/auth/session.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const migrationsDir = resolve(repoRoot, 'infra/migrations');

// --- Docker availability guard ---

const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
const dockerAvailable = dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// Build a session cookie using the same HMAC signing as the session middleware.
// Expires 1 hour from now — sufficient for test assertions.
function buildSessionCookie(accountId: bigint | string, hmacKey: string, email = 'test@example.com'): string {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const value = encodeSession({ account_id: String(accountId), owner_email: email, expires_at: expiresAt }, hmacKey);
  return `wb_session=${value}`;
}

// --- Test suite ---

describeIfDocker('POST /api/studies/:id/share-token (issue #487)', () => {
  let container = '';
  let dbUrl = '';
  let app: FastifyInstance;
  let accountId: bigint;
  let otherAccountId: bigint;

  // A study that has a report row (minted successfully).
  let studyWithReport: string;
  // A study with no report row yet.
  let studyNoReport: string;
  // A study owned by otherAccount (for 404 cross-account test).
  let otherStudyWithReport: string;

  const HMAC_KEY = 'test-session-hmac-key-share-tokens-487';

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-sharetoken-test-' });
    container = pg.container;
    dbUrl = pg.url;

    await applyMigrations(dbUrl);

    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      // Account 1.
      const acc1 = await client.query<{ id: bigint }>(
        `INSERT INTO accounts (owner_email) VALUES ('share-test@example.com') RETURNING id`,
      );
      accountId = acc1.rows[0]!.id;

      // Account 2 (cross-account ownership test).
      const acc2 = await client.query<{ id: bigint }>(
        `INSERT INTO accounts (owner_email) VALUES ('share-other@example.com') RETURNING id`,
      );
      otherAccountId = acc2.rows[0]!.id;

      // Study with report (account 1).
      const s1 = await client.query<{ id: string }>(
        `INSERT INTO studies (account_id, kind, status, urls)
         VALUES ($1, 'single', 'ready', ARRAY['https://example.com'])
         RETURNING id`,
        [String(accountId)],
      );
      studyWithReport = s1.rows[0]!.id;
      // share_token_hash is NOT NULL in the reports table (legacy column, see 0009_reports.sql).
      // Use a dummy hash value — the new minting endpoint stores tokens in share_tokens, not here.
      await client.query(
        `INSERT INTO reports (study_id, conv_score, paired_delta_json, share_token_hash, ready_at)
         VALUES ($1, 0.75, '{}', $2, now())`,
        [studyWithReport, sha256hex(`seed-dummy-${uid()}`)],
      );

      // Study without report (account 1).
      const s2 = await client.query<{ id: string }>(
        `INSERT INTO studies (account_id, kind, status, urls)
         VALUES ($1, 'single', 'ready', ARRAY['https://example.com'])
         RETURNING id`,
        [String(accountId)],
      );
      studyNoReport = s2.rows[0]!.id;

      // Study with report (account 2 — for cross-account 404).
      const s3 = await client.query<{ id: string }>(
        `INSERT INTO studies (account_id, kind, status, urls)
         VALUES ($1, 'single', 'ready', ARRAY['https://other.com'])
         RETURNING id`,
        [String(otherAccountId)],
      );
      otherStudyWithReport = s3.rows[0]!.id;
      await client.query(
        `INSERT INTO reports (study_id, conv_score, paired_delta_json, share_token_hash, ready_at)
         VALUES ($1, 0.50, '{}', $2, now())`,
        [otherStudyWithReport, sha256hex(`seed-dummy-other-${uid()}`)],
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
        DAILY_CAP_CENTS: 10_000,
        STRIPE_SECRET_KEY: 'sk_test_not_used_in_share_token_test',
        STRIPE_WEBHOOK_SECRET: 'whsec_not_used',
        STRIPE_PRICE_ID_STARTER: 'price_not_used',
        STRIPE_PRICE_ID_GROWTH: 'price_not_used',
        STRIPE_PRICE_ID_SCALE: 'price_not_used',
        SESSION_HMAC_KEY: HMAC_KEY,
        SHARE_TOKEN_HMAC_KEY: 'dev-only-share-token-hmac-key-not-for-production-use',
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (container) stopPostgres(container);
  });

  // --- 401: no session ---

  it('401 when no session cookie is present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/studies/${studyWithReport}/share-token`,
    });
    expect(res.statusCode).toBe(401);
  });

  // --- 404: study not owned by caller ---

  it('404 when study belongs to a different account', async () => {
    // Account 1 tries to mint a token for account 2's study.
    const cookie = buildSessionCookie(accountId, HMAC_KEY);
    const res = await app.inject({
      method: 'POST',
      url: `/api/studies/${otherStudyWithReport}/share-token`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  // --- 404: study has no report row yet ---

  it('404 when study exists but has no report row yet', async () => {
    const cookie = buildSessionCookie(accountId, HMAC_KEY);
    const res = await app.inject({
      method: 'POST',
      url: `/api/studies/${studyNoReport}/share-token`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  // --- 201: happy path ---

  it('201 with token, url, and expires_at on first mint', async () => {
    const cookie = buildSessionCookie(accountId, HMAC_KEY);
    const res = await app.inject({
      method: 'POST',
      url: `/api/studies/${studyWithReport}/share-token`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(201);

    const body = res.json<{ token: string; url: string; expires_at: string }>();
    expect(typeof body.token).toBe('string');
    expect(body.token).toHaveLength(22);
    expect(body.url).toBe(`https://willbuy.dev/r/${studyWithReport}?t=${body.token}`);

    // expires_at should be ~90 days from now (within a 5-minute window).
    const expiresAt = new Date(body.expires_at);
    const now = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThan(now + ninetyDaysMs - 5 * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThan(now + ninetyDaysMs + 5 * 60 * 1000);

    // Token must NOT be in DB (only the hash is stored).
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const row = await client.query<{ token_hash: string }>(
        `SELECT token_hash FROM share_tokens WHERE report_slug = $1`,
        [studyWithReport],
      );
      expect(row.rows).toHaveLength(1);
      // Verify the stored hash matches SHA-256 of the returned raw token.
      expect(row.rows[0]!.token_hash).toBe(sha256hex(body.token));
    } finally {
      await client.end();
    }
  });

  // --- 409: duplicate token for same report ---

  it('409 when a non-revoked, non-expired token already exists for this report', async () => {
    // The 201 test above already minted a token for studyWithReport.
    // A second call should return 409.
    const cookie = buildSessionCookie(accountId, HMAC_KEY);
    const res = await app.inject({
      method: 'POST',
      url: `/api/studies/${studyWithReport}/share-token`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
  });
});
