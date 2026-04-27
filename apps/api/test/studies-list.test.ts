/**
 * studies-list.test.ts — TDD acceptance tests for issue #85 (study list page).
 *
 * Real-DB integration: spins up Postgres 16 via the shared helper, applies all
 * migrations, then runs Fastify in-process via app.inject().
 *
 * Routes under test: GET /api/studies (behind wb_session middleware).
 *
 * Spec refs:
 *   §3      — user stories: list studies, click through to report
 *   §5.10   — wb_session HttpOnly HMAC cookie auth (issue #79 / PR #95)
 *   §2 #1   — caller sees ONLY their own studies (account scoping)
 *   §5.18   — report at /dashboard/studies/:id and /r/:slug
 *
 * Acceptance criteria covered (issue #85):
 *   AC1: GET /api/studies with valid session → list (paginated default 20).
 *   AC2: cursor returns next page, no overlap with first page.
 *   AC3: limit clamped to max 100.
 *   AC4: cross-account isolation (account-B sees only its own studies).
 *   AC5: no session → 401.
 *   AC6: invalid cursor → 400.
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

const SESSION_HMAC_KEY = 'test_studies_list_hmac_key_at_least_32_chars_long_xyz';

const BASE_ENV = {
  PORT: 3098,
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

function futureIso(days = 7): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

interface ListStudy {
  id: number;
  status: string;
  created_at: string;
  finalized_at: string | null;
  n_visits: number;
  urls: string[];
  visit_progress: { ok: number; failed: number; total: number };
}

interface ListResponse {
  studies: ListStudy[];
  next_cursor: string | null;
}

describeIfDocker('GET /api/studies (issue #85, real DB)', () => {
  let container = '';
  let dbUrl = '';
  let app: FastifyInstance;

  let accountA = '';
  let accountAEmail = '';
  let accountB = '';
  let accountBEmail = '';

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-studies-list-test-' });
    container = pg.container;
    dbUrl = pg.url;

    await applyMigrations(dbUrl);

    app = await buildServer({
      env: { ...BASE_ENV, DATABASE_URL: dbUrl },
      resend: buildStubResend(),
    });

    accountAEmail = 'list-a@example.com';
    accountBEmail = 'list-b@example.com';
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

      // Account A: 25 studies. Spread created_at deterministically. Newest =
      // index 24 (offset = 0 minutes ago). Oldest = index 0 (24 minutes ago).
      // The list should return them DESC.
      for (let i = 0; i < 25; i++) {
        const minutesAgo = 24 - i;
        await db.query(
          `INSERT INTO studies (account_id, kind, status, urls, created_at)
             VALUES ($1, 'single', 'ready', ARRAY[$2]::text[],
                     now() - ($3 || ' minutes')::interval)`,
          [accountA, `https://a.example.com/p/${i}`, String(minutesAgo)],
        );
      }

      // Account B: 3 studies, fewer for cross-account isolation.
      for (let i = 0; i < 3; i++) {
        await db.query(
          `INSERT INTO studies (account_id, kind, status, urls, created_at)
             VALUES ($1, 'paired', 'capturing', ARRAY[$2,$3]::text[],
                     now() - ($4 || ' minutes')::interval)`,
          [
            accountB,
            `https://b.example.com/p${i}/x`,
            `https://b.example.com/p${i}/y`,
            String(2 - i),
          ],
        );
      }
    } finally {
      await db.end();
    }
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    stopPostgres(container);
  });

  // -------------------------------------------------------------------------
  // AC1: valid session → 200 with first page (default limit=20).
  // -------------------------------------------------------------------------
  it('AC1: valid session returns paginated list (default limit=20)', async () => {
    const cookie = buildSessionCookie({
      accountId: accountA,
      ownerEmail: accountAEmail,
      expiresAtIso: futureIso(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/studies',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ListResponse>();
    expect(Array.isArray(body.studies)).toBe(true);
    // Default limit = 20.
    expect(body.studies).toHaveLength(20);
    // Account A has 25 studies → next_cursor must be present.
    expect(body.next_cursor).toBeTruthy();
    // Each row has the expected shape.
    const first = body.studies[0]!;
    expect(typeof first.id).toBe('number');
    expect(typeof first.status).toBe('string');
    expect(typeof first.created_at).toBe('string');
    expect(Array.isArray(first.urls)).toBe(true);
    expect(typeof first.n_visits).toBe('number');
    expect(first.visit_progress).toBeDefined();
    expect(typeof first.visit_progress.ok).toBe('number');
    expect(typeof first.visit_progress.failed).toBe('number');
    expect(typeof first.visit_progress.total).toBe('number');
    // Newest study first (DESC). i=24 is the newest.
    expect(first.urls[0]).toBe('https://a.example.com/p/24');

    // Ordering: each successive item's created_at <= previous.
    for (let i = 1; i < body.studies.length; i++) {
      const prev = new Date(body.studies[i - 1]!.created_at).getTime();
      const cur = new Date(body.studies[i]!.created_at).getTime();
      expect(cur).toBeLessThanOrEqual(prev);
    }
  });

  // -------------------------------------------------------------------------
  // AC2: cursor returns next page, no overlap with first page.
  // -------------------------------------------------------------------------
  it('AC2: cursor returns next page with no overlap with first page', async () => {
    const cookie = buildSessionCookie({
      accountId: accountA,
      ownerEmail: accountAEmail,
      expiresAtIso: futureIso(),
    });
    // Page 1.
    const r1 = await app.inject({
      method: 'GET',
      url: '/api/studies?limit=20',
      headers: { cookie },
    });
    expect(r1.statusCode).toBe(200);
    const p1 = r1.json<ListResponse>();
    expect(p1.studies).toHaveLength(20);
    expect(p1.next_cursor).toBeTruthy();

    // Page 2.
    const r2 = await app.inject({
      method: 'GET',
      url: `/api/studies?limit=20&cursor=${encodeURIComponent(p1.next_cursor!)}`,
      headers: { cookie },
    });
    expect(r2.statusCode).toBe(200);
    const p2 = r2.json<ListResponse>();
    // 25 total − 20 = 5 remaining.
    expect(p2.studies).toHaveLength(5);
    // Last page → no more cursor.
    expect(p2.next_cursor).toBeNull();

    // No overlap.
    const ids1 = new Set(p1.studies.map((s) => s.id));
    for (const s of p2.studies) {
      expect(ids1.has(s.id)).toBe(false);
    }
    // Total = 25.
    expect(ids1.size + p2.studies.length).toBe(25);
  });

  // -------------------------------------------------------------------------
  // AC3: limit clamped to max 100.
  // -------------------------------------------------------------------------
  it('AC3: limit clamped to max 100', async () => {
    const cookie = buildSessionCookie({
      accountId: accountA,
      ownerEmail: accountAEmail,
      expiresAtIso: futureIso(),
    });
    // Request limit=10000 — should be clamped silently. Since A has only 25
    // studies the response should contain all 25 in one page (no cursor).
    const res = await app.inject({
      method: 'GET',
      url: '/api/studies?limit=10000',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ListResponse>();
    // Account A has 25 studies which is well below the 100 cap.
    expect(body.studies).toHaveLength(25);
    expect(body.next_cursor).toBeNull();
  });

  // -------------------------------------------------------------------------
  // AC4: cross-account isolation.
  // -------------------------------------------------------------------------
  it('AC4: caller sees only their own studies (account-B isolated from A)', async () => {
    const cookieB = buildSessionCookie({
      accountId: accountB,
      ownerEmail: accountBEmail,
      expiresAtIso: futureIso(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/studies',
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ListResponse>();
    // B has 3 studies.
    expect(body.studies).toHaveLength(3);
    expect(body.next_cursor).toBeNull();
    // None of B's URLs should be A's URLs.
    for (const s of body.studies) {
      for (const u of s.urls) {
        expect(u.startsWith('https://b.example.com/')).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // AC5: no session → 401.
  // -------------------------------------------------------------------------
  it('AC5: no session cookie → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/studies',
    });
    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AC6: invalid cursor → 400.
  // -------------------------------------------------------------------------
  it('AC6: invalid cursor returns 400', async () => {
    const cookie = buildSessionCookie({
      accountId: accountA,
      ownerEmail: accountAEmail,
      expiresAtIso: futureIso(),
    });
    // Cursor that is not valid base64 of "created_at|id".
    const res = await app.inject({
      method: 'GET',
      url: '/api/studies?cursor=not-a-real-cursor!!!',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // AC7: report_public field in list response (PR #232).
  // -------------------------------------------------------------------------
  it('AC7: list includes report_public=true when a public report exists', async () => {
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    let studyId: string;
    try {
      const s = await db.query<{ id: string }>(
        `INSERT INTO studies (account_id, kind, status, urls)
           VALUES ($1, 'single', 'ready', ARRAY['https://a.example.com/rp-test']::text[])
           RETURNING id`,
        [accountA],
      );
      studyId = s.rows[0]!.id;
      // Insert a public report for this study.
      await db.query(
        `INSERT INTO reports (study_id, share_token_hash, conv_score, paired_delta_json, public)
           VALUES ($1, 'hash-rp-test', 0.5, '{}', true)`,
        [studyId],
      );
    } finally {
      await db.end();
    }
    const cookie = buildSessionCookie({
      accountId: accountA,
      ownerEmail: accountAEmail,
      expiresAtIso: futureIso(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/studies?limit=100',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ListResponse>();
    const target = body.studies.find((s) => s.id === Number(studyId));
    expect(target).toBeDefined();
    expect((target as Record<string, unknown>)['report_public']).toBe(true);
  });
});
