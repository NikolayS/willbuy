/**
 * dashboard.test.ts — TDD acceptance tests for issue #80 (account dashboard).
 *
 * Real-DB integration: spins up Postgres 16 via the shared helper, applies
 * all migrations, then runs Fastify in-process via app.inject().
 *
 * Routes under test: GET /api/dashboard/summary (behind wb_session middleware).
 *
 * Spec refs:
 *   §3      — user stories (balance, recent studies, buy credits CTA)
 *   §5.10   — CSP / cookie flags (auth surface)
 *   §5.4    — credit_ledger / account_balance view
 *   §2 #20  — no existence leak (401 generic on bad session)
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

// --- Docker availability guard ---
const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
const dockerAvailable = dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

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

// Stub Resend client; magic-link endpoint isn't exercised here but buildServer
// requires one.
function buildStubResend(): ResendClient {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    async sendMagicLink() {
      callCount += 1;
    },
    async sendCapWarning() {
      // no-op stub
    },
  };
}

const SESSION_HMAC_KEY = 'test_dashboard_hmac_key_at_least_32_characters_long_xyz';

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

/**
 * Build a session cookie string ready for the Cookie request header.
 * `expiresAtIso` lets tests forge expired sessions (the cookie is HMAC-valid
 * but the embedded expires_at is in the past — decodeSession returns null).
 */
function buildSessionCookie(opts: {
  accountId: string;
  ownerEmail: string;
  expiresAtIso: string;
}): string {
  const value = encodeSession(
    {
      account_id: opts.accountId,
      owner_email: opts.ownerEmail,
      expires_at: opts.expiresAtIso,
    },
    SESSION_HMAC_KEY,
  );
  return `wb_session=${value}`;
}

// Future timestamp helper.
function futureIso(days = 7): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

describeIfDocker('GET /api/dashboard/summary (issue #80, real DB)', () => {
  let container = '';
  let dbUrl = '';
  let app: FastifyInstance;

  // Two test accounts, populated in beforeAll.
  let accountA = '';
  let accountAEmail = '';
  let accountB = '';
  let accountBEmail = '';

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-dashboard-test-' });
    container = pg.container;
    dbUrl = pg.url;

    await applyMigrations(dbUrl);

    app = await buildServer({
      env: { ...BASE_ENV, DATABASE_URL: dbUrl },
      resend: buildStubResend(),
    });

    // Seed two accounts directly (bypass magic-link flow — that's covered by
    // auth.test.ts; this suite focuses on the dashboard route).
    accountAEmail = 'dash-a@example.com';
    accountBEmail = 'dash-b@example.com';
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const a = await db.query<{ id: string }>(
        `INSERT INTO accounts (owner_email) VALUES ($1) RETURNING id`,
        [accountAEmail],
      );
      const b = await db.query<{ id: string }>(
        `INSERT INTO accounts (owner_email) VALUES ($1) RETURNING id`,
        [accountBEmail],
      );
      accountA = a.rows[0]!.id;
      accountB = b.rows[0]!.id;

      // Account A: $50 top-up minus $7 reserve = $43 = 4300¢.
      await db.query(
        `INSERT INTO credit_ledger (account_id, kind, cents, idempotency_key)
         VALUES ($1, 'top_up', 5000, 'dash-test-a-topup-1')`,
        [accountA],
      );
      await db.query(
        `INSERT INTO credit_ledger (account_id, kind, cents, idempotency_key)
         VALUES ($1, 'reserve', -700, 'dash-test-a-reserve-1')`,
        [accountA],
      );

      // Account A: 12 studies — verify ordering DESC and limit 10. Use a kind
      // 'single' with one URL each. Insert in reverse order so older rows have
      // smaller IDs but later created_at would conflict; use explicit
      // created_at offsets to make ordering deterministic.
      for (let i = 0; i < 12; i++) {
        const minutesAgo = 12 - i; // study 0 is the oldest, study 11 the newest
        await db.query(
          `INSERT INTO studies (account_id, kind, status, urls, created_at)
           VALUES ($1, 'single', 'ready', ARRAY[$2]::text[], now() - ($3 || ' minutes')::interval)`,
          [accountA, `https://example.com/p/${i}`, String(minutesAgo)],
        );
      }

      // Account B: smaller fixture for isolation tests. $10 top-up.
      await db.query(
        `INSERT INTO credit_ledger (account_id, kind, cents, idempotency_key)
         VALUES ($1, 'top_up', 1000, 'dash-test-b-topup-1')`,
        [accountB],
      );
      // One study for B.
      await db.query(
        `INSERT INTO studies (account_id, kind, status, urls)
         VALUES ($1, 'paired', 'capturing', ARRAY['https://b.example.com/x','https://b.example.com/y']::text[])`,
        [accountB],
      );
    } finally {
      await db.end();
    }
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    stopPostgres(container);
  });

  // -------------------------------------------------------------------------
  // AC1: valid session cookie → 200 with expected shape.
  // -------------------------------------------------------------------------
  it('AC1: valid session cookie → 200 with email/balance/recent_studies', async () => {
    const cookie = buildSessionCookie({
      accountId: accountA,
      ownerEmail: accountAEmail,
      expiresAtIso: futureIso(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      email: string;
      balance_cents: number;
      recent_studies: Array<{
        id: number;
        status: string;
        created_at: string;
        n_visits: number;
        urls: string[];
      }>;
    }>();
    expect(body.email).toBe(accountAEmail);
    // 5000 - 700 = 4300
    expect(body.balance_cents).toBe(4300);
    expect(Array.isArray(body.recent_studies)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC2: no cookie → 401.
  // -------------------------------------------------------------------------
  it('AC2: no cookie → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
    });
    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AC3: tampered HMAC → 401.
  // -------------------------------------------------------------------------
  it('AC3: invalid cookie HMAC → 401', async () => {
    const goodCookie = buildSessionCookie({
      accountId: accountA,
      ownerEmail: accountAEmail,
      expiresAtIso: futureIso(),
    });
    // Flip the last byte of the MAC.
    const value = goodCookie.slice('wb_session='.length);
    const tampered =
      value.slice(0, -1) + (value.slice(-1) === 'A' ? 'B' : 'A');
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { cookie: `wb_session=${tampered}` },
    });
    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AC4: expired session payload → 401.
  // -------------------------------------------------------------------------
  it('AC4: expired session (past expires_at) → 401', async () => {
    const expiredCookie = buildSessionCookie({
      accountId: accountA,
      ownerEmail: accountAEmail,
      // 1 hour in the past — HMAC is valid but decodeSession rejects expired.
      expiresAtIso: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { cookie: expiredCookie },
    });
    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AC5: balance reflects credit_ledger sum.
  // -------------------------------------------------------------------------
  it('AC5: balance_cents reflects credit_ledger sum', async () => {
    const cookie = buildSessionCookie({
      accountId: accountB,
      ownerEmail: accountBEmail,
      expiresAtIso: futureIso(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ balance_cents: number }>();
    expect(body.balance_cents).toBe(1000);
  });

  // -------------------------------------------------------------------------
  // AC6: studies ordered DESC by created_at, max 10, scoped to caller.
  // -------------------------------------------------------------------------
  it('AC6: recent_studies is DESC by created_at and capped at 10, scoped to caller', async () => {
    const cookie = buildSessionCookie({
      accountId: accountA,
      ownerEmail: accountAEmail,
      expiresAtIso: futureIso(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      recent_studies: Array<{ id: number; created_at: string; urls: string[] }>;
    }>();
    expect(body.recent_studies).toHaveLength(10);
    // Ordering: each successive item's created_at <= previous.
    for (let i = 1; i < body.recent_studies.length; i++) {
      const prev = new Date(body.recent_studies[i - 1]!.created_at).getTime();
      const cur = new Date(body.recent_studies[i]!.created_at).getTime();
      expect(cur).toBeLessThanOrEqual(prev);
    }
    // Newest study (i=11) should be the first entry; URLs check confirms scope.
    expect(body.recent_studies[0]!.urls[0]).toBe('https://example.com/p/11');

    // Account-B caller does not see Account-A studies.
    const bCookie = buildSessionCookie({
      accountId: accountB,
      ownerEmail: accountBEmail,
      expiresAtIso: futureIso(),
    });
    const bRes = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { cookie: bCookie },
    });
    const bBody = bRes.json<{
      recent_studies: Array<{ urls: string[] }>;
    }>();
    expect(bBody.recent_studies).toHaveLength(1);
    expect(bBody.recent_studies[0]!.urls[0]).toBe('https://b.example.com/x');
  });

  // -------------------------------------------------------------------------
  // AC7: each study includes status, n_visits, urls, created_at, id.
  // -------------------------------------------------------------------------
  it('AC7: study rows expose id, status, created_at, n_visits, urls', async () => {
    const cookie = buildSessionCookie({
      accountId: accountB,
      ownerEmail: accountBEmail,
      expiresAtIso: futureIso(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      recent_studies: Array<{
        id: number;
        status: string;
        created_at: string;
        n_visits: number;
        urls: string[];
      }>;
    }>();
    const s = body.recent_studies[0]!;
    expect(typeof s.id).toBe('number');
    expect(['pending', 'capturing', 'visiting', 'aggregating', 'ready', 'failed'])
      .toContain(s.status);
    expect(typeof s.created_at).toBe('string');
    expect(Array.isArray(s.urls)).toBe(true);
    expect(s.urls).toEqual(['https://b.example.com/x', 'https://b.example.com/y']);
    // n_visits = count of backstories for the study; B has none seeded → 0.
    expect(s.n_visits).toBe(0);
  });
});
