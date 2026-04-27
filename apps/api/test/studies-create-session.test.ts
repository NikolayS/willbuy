/**
 * studies-create-session.test.ts — TDD acceptance for
 * POST /api/studies (session-cookie auth).
 *
 * The API-key path (POST /studies) is extensively tested in studies.api.test.ts.
 * This suite covers the session-cookie mirror that allows authenticated dashboard
 * users to create studies from the browser without a programmatic API key.
 *
 * Spec refs:
 *   §5.10   — wb_session HttpOnly HMAC cookie auth
 *   §2 #1   — verified-domain check
 *   §2 #18  — paired A/B = exactly 2 URLs
 *
 * Acceptance criteria:
 *   AC1: valid session + verified domain → 201 { study_id, status: 'capturing' }
 *   AC2: no session cookie → 401
 *   AC3: unverified domain → 422
 *   AC4: invalid URL format → 422
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
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

const SESSION_HMAC_KEY = 'test_create_session_hmac_key_at_least_32_chars_long_xyz';

const BASE_ENV = {
  PORT: 3100,
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

function uid(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describeIfDocker('POST /api/studies (session-cookie auth)', () => {
  let container = '';
  let app: FastifyInstance;
  let db: Client;
  let accountId = '';
  let accountEmail = '';
  const VERIFIED_DOMAIN = 'test-create-sess.example.com';

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-create-session-test-' });
    container = pg.container;
    db = new Client({ connectionString: pg.url });
    await db.connect();
    await applyMigrations(pg.url);
    app = await buildServer({
      env: { ...BASE_ENV, DATABASE_URL: pg.url },
      resend: buildStubResend(),
    });

    accountEmail = `create-sess-${uid()}@example.com`;
    const row = await db.query<{ id: string }>(
      `INSERT INTO accounts (owner_email, verified_domains)
       VALUES ($1, ARRAY[$2]::text[])
       RETURNING id`,
      [accountEmail, VERIFIED_DOMAIN],
    );
    accountId = row.rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await db.end();
    await app.close();
    stopPostgres(container);
  });

  // ── AC1: happy path ───────────────────────────────────────────────────────

  it('AC1: valid session + verified domain → 201 { study_id, status: "capturing" }', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/studies',
      headers: {
        cookie: sessionCookie(accountId, accountEmail),
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        urls: [`https://${VERIFIED_DOMAIN}/pricing`],
        icp: { preset_id: 'devtools_engineer' },
        n_visits: 2,
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { study_id: number; status: string };
    expect(typeof body.study_id).toBe('number');
    expect(body.status).toBe('capturing');

    // Verify DB: study row exists with correct status.
    const studyRow = await db.query<{ status: string }>(
      `SELECT status FROM studies WHERE id = $1 AND account_id = $2`,
      [String(body.study_id), accountId],
    );
    expect(studyRow.rows[0]!.status).toBe('capturing');
  });

  // ── AC2: no session → 401 ────────────────────────────────────────────────

  it('AC2: missing session cookie → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/studies',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        urls: [`https://${VERIFIED_DOMAIN}/pricing`],
        icp: { preset_id: 'devtools_engineer' },
        n_visits: 1,
      }),
    });
    expect(res.statusCode).toBe(401);
  });

  // ── AC3: unverified domain → 422 ─────────────────────────────────────────

  it('AC3: URL domain not in verified_domains → 422 with error message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/studies',
      headers: {
        cookie: sessionCookie(accountId, accountEmail),
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        urls: ['https://not-verified.example.org/page'],
        icp: { preset_id: 'saas_founder_pre_pmf' },
        n_visits: 1,
      }),
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/unverified domain/i);
  });

  // ── AC4: invalid URL format → 422 ────────────────────────────────────────

  it('AC4: malformed URL → 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/studies',
      headers: {
        cookie: sessionCookie(accountId, accountEmail),
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        urls: ['not-a-valid-url'],
        icp: { preset_id: 'saas_founder_pre_pmf' },
        n_visits: 1,
      }),
    });
    expect(res.statusCode).toBe(422);
  });
});
