/**
 * studies-publish-session.test.ts — TDD acceptance for
 * POST /api/studies/:id/publish (session-cookie auth).
 *
 * The API-key path (POST /studies/:id/publish) is tested in studies.api.test.ts.
 * This suite covers the session-cookie mirror that allows dashboard users to
 * publish reports without a programmatic API key.
 *
 * Spec refs:
 *   §5.10   — wb_session HttpOnly HMAC cookie auth
 *   §2 #1   — account scoping (cannot publish another account's report)
 *
 * Acceptance criteria:
 *   AC1: valid session + study with report → 200 { study_id, public: true }
 *   AC2: valid session + study without report → 404
 *   AC3: valid session + study owned by different account → 404 (no existence leak)
 *   AC4: no session cookie → 401
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
import type { ResendClient } from '../src/email/resend.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const migrationsDir = resolve(repoRoot, 'infra/migrations');

// ── Docker guard ─────────────────────────────────────────────────────────────
const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
const dockerAvailable = dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function applyMigrations(url: string): Promise<void> {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const file of files) {
      await client.query(readFileSync(resolve(migrationsDir, file), 'utf8'));
    }
  } finally {
    await client.end();
  }
}

function buildStubResend(): ResendClient {
  let n = 0;
  return {
    get callCount() { return n; },
    async sendMagicLink() { n += 1; },
    async sendCapWarning() { /* no-op */ },
  };
}

const SESSION_HMAC_KEY = 'test_publish_session_hmac_key_at_least_32_chars_long_xyz';

const BASE_ENV = {
  PORT: 3099,
  LOG_LEVEL: 'silent' as const,
  URL_HASH_SALT: 'test_salt_at_least_32_characters_long_abc',
  DAILY_CAP_CENTS: 10_000,
  STRIPE_SECRET_KEY: 'sk_test_not_configured',
  STRIPE_WEBHOOK_SECRET: 'whsec_not_configured',
  STRIPE_PRICE_ID_STARTER: 'price_not_configured',
  STRIPE_PRICE_ID_GROWTH: 'price_not_configured',
  STRIPE_PRICE_ID_SCALE: 'price_not_configured',
  RESEND_API_KEY: 're_test_dummy',
  RESEND_TEST_MODE: 'stub' as const,
  SESSION_HMAC_KEY,
  NODE_ENV: 'test' as const,
};

function sessionCookie(accountId: string, email: string): string {
  const value = encodeSession(
    {
      account_id: accountId,
      owner_email: email,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    SESSION_HMAC_KEY,
  );
  return `wb_session=${value}`;
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describeIfDocker('POST /api/studies/:id/publish (session-cookie auth)', () => {
  let container = '';
  let app: FastifyInstance;
  let db: Client;
  let accountA = '';
  let accountAEmail = '';
  let accountB = '';

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-publish-session-test-' });
    container = pg.container;
    db = new Client({ connectionString: pg.url });
    await db.connect();
    await applyMigrations(pg.url);
    app = await buildServer({
      env: { ...BASE_ENV, DATABASE_URL: pg.url },
      resend: buildStubResend(),
    });

    accountAEmail = `pub-a-${uid()}@example.com`;
    const emailB = `pub-b-${uid()}@example.com`;
    const aRow = await db.query<{ id: string }>(`INSERT INTO accounts (owner_email) VALUES ($1) RETURNING id`, [accountAEmail]);
    const bRow = await db.query<{ id: string }>(`INSERT INTO accounts (owner_email) VALUES ($1) RETURNING id`, [emailB]);
    accountA = aRow.rows[0]!.id;
    accountB = bRow.rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await db.end();
    await app.close();
    stopPostgres(container);
  });

  // ── AC1: happy path — study has a report ──────────────────────────────────

  it('AC1: valid session + study with report → 200 { study_id, public: true }', async () => {
    // Insert a study + report row for account A.
    const sRow = await db.query<{ id: string }>(
      `INSERT INTO studies (account_id, kind, status, urls) VALUES ($1, 'single', 'ready', ARRAY[$2]::text[]) RETURNING id`,
      [accountA, 'https://example.com/pub-ac1'],
    );
    const studyId = sRow.rows[0]!.id;
    await db.query(
      `INSERT INTO reports (study_id, share_token_hash, conv_score, paired_delta_json)
       VALUES ($1, $2, 0.5, '{}')`,
      [studyId, sha256hex(`ac1-tok-${uid()}`)],
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/studies/${studyId}/publish`,
      headers: { cookie: sessionCookie(accountA, accountAEmail) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { study_id: number; public: boolean };
    expect(body.study_id).toBe(Number(studyId));
    expect(body.public).toBe(true);

    // Verify DB side-effect: reports.public is now true.
    const row = await db.query<{ public: boolean }>(`SELECT public FROM reports WHERE study_id = $1`, [studyId]);
    expect(row.rows[0]!.public).toBe(true);
  });

  // ── AC2: study exists but has no report yet ───────────────────────────────

  it('AC2: study without a report row → 404', async () => {
    const sRow = await db.query<{ id: string }>(
      `INSERT INTO studies (account_id, kind, status, urls) VALUES ($1, 'single', 'capturing', ARRAY['https://example.com/pub-ac2']::text[]) RETURNING id`,
      [accountA],
    );
    const studyId = sRow.rows[0]!.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/studies/${studyId}/publish`,
      headers: { cookie: sessionCookie(accountA, accountAEmail) },
    });

    expect(res.statusCode).toBe(404);
  });

  // ── AC3: cross-account isolation ─────────────────────────────────────────

  it("AC3: account B cannot publish account A's report (404, no existence leak)", async () => {
    const sRow = await db.query<{ id: string }>(
      `INSERT INTO studies (account_id, kind, status, urls) VALUES ($1, 'single', 'ready', ARRAY['https://example.com/pub-ac3']::text[]) RETURNING id`,
      [accountA],
    );
    const studyId = sRow.rows[0]!.id;
    await db.query(
      `INSERT INTO reports (study_id, share_token_hash, conv_score, paired_delta_json) VALUES ($1, $2, 0.5, '{}')`,
      [studyId, sha256hex(`ac3-tok-${uid()}`)],
    );

    const emailB = `pub-b-${uid()}@example.com`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/studies/${studyId}/publish`,
      headers: { cookie: sessionCookie(accountB, emailB) },
    });

    expect(res.statusCode).toBe(404);
    // Verify the report was NOT published.
    const row = await db.query<{ public: boolean }>(`SELECT public FROM reports WHERE study_id = $1`, [studyId]);
    expect(row.rows[0]!.public).toBe(false);
  });

  // ── AC4: no session → 401 ────────────────────────────────────────────────

  it('AC4: missing session cookie → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/studies/999/publish',
    });
    expect(res.statusCode).toBe(401);
  });
});
