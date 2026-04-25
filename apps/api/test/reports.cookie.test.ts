/**
 * reports.cookie.test.ts — TDD acceptance tests for issue #76.
 *
 * §5.12 share-token HttpOnly cookie redirect.
 *
 * Real-DB integration: spins up a Postgres 16 container via Docker, applies
 * all migrations, seeds data, runs Fastify in-process via app.inject().
 *
 * Paths tested:
 *  1. Token in URL (valid)              → 302 to /r/<slug> + Set-Cookie: HttpOnly
 *  2. Token in URL (expired in DB)      → 404, NO cookie, NO body leak
 *  3. Token in URL (revoked)            → 404, NO cookie
 *  4. Token in URL (wrong token)        → 404, NO cookie (timing-safe compare)
 *  5. Cookie present (valid)            → 200 with full report body. Cache-Control: no-store
 *  6. Cookie present (HMAC tampered)    → 404, response sets nothing
 *  7. Cookie present (DB-side revoked)  → 404 (re-check on every cookie read)
 *  8. No token, no cookie, public=true  → 200
 *  9. No token, no cookie, public=false → 404
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';

import { startPostgres, stopPostgres } from '../../../tests/helpers/start-postgres.js';
import { buildServer } from '../src/server.js';

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

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function applyMigrations(url: string): Promise<void> {
  // All migrations including 0014_share_tokens.sql (issue #76).
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

// Shared HMAC key used in all test cases — must match what the server uses.
const TEST_HMAC_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

// Cookie name helper — mirrors server implementation (spec §2 #20).
function cookieName(slug: string): string {
  return `wb_rt_${slug}`;
}

// Build a valid HMAC cookie value for a slug+expiresAt+accountId combination.
function buildHmacCookie(slug: string, expiresAt: Date, accountId: bigint): string {
  const payload = `${slug}:${expiresAt.toISOString()}:${String(accountId)}`;
  const sig = createHmac('sha256', TEST_HMAC_KEY).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

// Parse Set-Cookie header from response (may be string or string[]).
function parseCookieHeader(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

// --- Test suite ---

describeIfDocker('§5.12 share-token HttpOnly cookie redirect (issue #76)', () => {
  let container = '';
  let dbUrl = '';
  let app: FastifyInstance;
  let accountId: bigint;

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-cookie-test-' });
    container = pg.container;
    dbUrl = pg.url;

    await applyMigrations(dbUrl);

    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const acc = await client.query<{ id: bigint }>(
        `INSERT INTO accounts (owner_email) VALUES ('cookie-test@example.com') RETURNING id`,
      );
      accountId = acc.rows[0]!.id;
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
        STRIPE_SECRET_KEY: 'sk_test_not_used',
        STRIPE_WEBHOOK_SECRET: 'whsec_not_used',
        STRIPE_PRICE_ID_STARTER: 'price_not_used',
        STRIPE_PRICE_ID_GROWTH: 'price_not_used',
        STRIPE_PRICE_ID_SCALE: 'price_not_used',
        SHARE_TOKEN_HMAC_KEY: TEST_HMAC_KEY,
      },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    if (container) stopPostgres(container);
  });

  // Helper: insert a study + report row and optionally a share_tokens row.
  async function seedReport(opts: {
    shareToken: string;
    public?: boolean;
    expiresAt?: Date | null; // null = no expires_at on reports row
    revoked?: boolean;       // for share_tokens row
    tokenExpired?: boolean;  // for share_tokens row expires_at in the past
    skipShareTokenRow?: boolean; // only insert reports row (original schema path)
    reportExpiresAt?: Date | null; // expires_at on reports row itself
  }): Promise<{ slug: string; studyId: bigint; expiresAt: Date | null }> {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const s = await client.query<{ id: bigint }>(
        `INSERT INTO studies (account_id, kind, status)
         VALUES ($1, 'single', 'ready') RETURNING id`,
        [String(accountId)],
      );
      const studyId = s.rows[0]!.id;
      const slug = String(studyId);
      const tokenHash = sha256hex(opts.shareToken);

      // Insert report row using old schema (share_token_hash on reports).
      await client.query(
        `INSERT INTO reports
           (study_id, share_token_hash, conv_score, paired_delta_json, public, expires_at)
         VALUES ($1, $2, 0.75, '{"delta": 0.1}', $3, $4)`,
        [
          String(studyId),
          tokenHash,
          opts.public ?? false,
          opts.reportExpiresAt !== undefined ? opts.reportExpiresAt : null,
        ],
      );

      // Insert share_tokens row if requested.
      let shareTokenExpiresAt: Date | null = null;
      if (!opts.skipShareTokenRow) {
        const fut = new Date();
        fut.setDate(fut.getDate() + 90); // 90 days from now by default
        if (opts.tokenExpired) {
          fut.setTime(Date.now() - 1000); // 1 second in the past
        }
        shareTokenExpiresAt = fut;

        const revokedAt = opts.revoked ? new Date() : null;

        await client.query(
          `INSERT INTO share_tokens
             (report_slug, token_hash, expires_at, revoked_at, account_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [slug, tokenHash, fut, revokedAt, String(accountId)],
        );
      }

      return { slug, studyId, expiresAt: shareTokenExpiresAt };
    } finally {
      await client.end();
    }
  }

  // ---------------------------------------------------------------------------
  // Path 1: Token in URL (valid) → 302 + Set-Cookie HttpOnly
  // ---------------------------------------------------------------------------
  it('1. valid token in URL → 302 to /r/<slug> + Set-Cookie: HttpOnly; Secure; SameSite=Lax', async () => {
    const token = `tok1_${uid()}`;
    const { slug, expiresAt } = await seedReport({ shareToken: token });

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}?t=${token}`,
    });

    expect(res.statusCode, 'should 302').toBe(302);
    expect(res.headers['location'], 'should redirect to bare slug').toBe(`/r/${slug}`);
    expect(res.headers['cache-control'], 'no-store on redirect').toBe('no-store');

    // Set-Cookie must be present and HttpOnly.
    const cookies = parseCookieHeader(res.headers['set-cookie'] as string | string[]);
    expect(cookies.length, 'at least one Set-Cookie header').toBeGreaterThan(0);

    const cookieStr = cookies.find((c) => c.startsWith(`wb_rt_${slug}=`));
    expect(cookieStr, 'correct cookie name (wb_rt_<slug> per spec §2 #20)').toBeTruthy();
    expect(cookieStr, 'HttpOnly flag').toMatch(/HttpOnly/i);
    expect(cookieStr, 'Secure flag').toMatch(/Secure/i);
    expect(cookieStr, 'SameSite=Lax').toMatch(/SameSite=Lax/i);
    expect(cookieStr, 'Path scoped to /r/<slug>').toContain(`Path=/r/${slug}`);

    // Body should be empty (it's a 302 redirect).
    expect(res.body, 'no body on redirect').toBe('');

    void expiresAt; // used to verify cookie presence
  });

  // ---------------------------------------------------------------------------
  // Path 2: Token in URL (expired) → 404, no cookie
  // ---------------------------------------------------------------------------
  it('2. expired token in URL → 404, no cookie set', async () => {
    const token = `tok2_${uid()}`;
    const { slug } = await seedReport({ shareToken: token, tokenExpired: true });

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}?t=${token}`,
    });

    expect(res.statusCode, 'should 404 for expired').toBe(404);
    const cookies = parseCookieHeader(res.headers['set-cookie'] as string | string[]);
    expect(cookies.length, 'no cookie on expired').toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Path 3: Token in URL (revoked) → 404, no cookie
  // ---------------------------------------------------------------------------

  it('3. revoked token in URL → 404, no cookie', async () => {
    const token = `tok3_${uid()}`;
    const { slug } = await seedReport({ shareToken: token, revoked: true });

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}?t=${token}`,
    });

    expect(res.statusCode, 'should 404 for revoked').toBe(404);
    const cookies = parseCookieHeader(res.headers['set-cookie'] as string | string[]);
    expect(cookies.length, 'no cookie on revoked').toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Path 4: Wrong token → 404, no cookie
  // ---------------------------------------------------------------------------
  it('4. wrong token in URL → 404, no cookie (timing-safe)', async () => {
    const token = `tok4_${uid()}`;
    const { slug } = await seedReport({ shareToken: token });

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}?t=completelyWrongToken`,
    });

    expect(res.statusCode, 'should 404 for wrong token').toBe(404);
    const cookies = parseCookieHeader(res.headers['set-cookie'] as string | string[]);
    expect(cookies.length, 'no cookie on wrong token').toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Path 5: Cookie present (valid) → 200 with report body, Cache-Control: no-store
  // ---------------------------------------------------------------------------
  it('5. valid cookie → 200 with report body + Cache-Control: no-store', async () => {
    const token = `tok5_${uid()}`;
    const { slug, expiresAt } = await seedReport({ shareToken: token });

    // Build a valid HMAC cookie.
    const cookieValue = buildHmacCookie(slug, expiresAt!, accountId);

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}`,
      headers: { cookie: `${cookieName(slug)}=${cookieValue}` },
    });

    expect(res.statusCode, 'should 200 with valid cookie').toBe(200);
    expect(res.headers['cache-control'], 'no-store with cookie').toBe('no-store');

    const body = res.json() as { study_id: number; conv_score: number };
    expect(body.study_id, 'has study_id').toBeDefined();
    expect(typeof body.conv_score, 'conv_score is number').toBe('number');
  });

  // ---------------------------------------------------------------------------
  // Path 6: Cookie with tampered HMAC → 404
  // ---------------------------------------------------------------------------
  it('6. HMAC-tampered cookie → 404, no new cookie set', async () => {
    const token = `tok6_${uid()}`;
    const { slug, expiresAt } = await seedReport({ shareToken: token });

    // Build a tampered cookie (flip last char of signature).
    const valid = buildHmacCookie(slug, expiresAt!, accountId);
    const tampered = valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a');

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}`,
      headers: { cookie: `${cookieName(slug)}=${tampered}` },
    });

    expect(res.statusCode, 'should 404 on tampered cookie').toBe(404);
    const cookies = parseCookieHeader(res.headers['set-cookie'] as string | string[]);
    expect(cookies.length, 'no cookie set on tampered').toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Path 7: Cookie valid but DB-side revoked → 404
  // ---------------------------------------------------------------------------
  it('7. valid cookie but DB token revoked → 404 (re-check on every read)', async () => {
    const token = `tok7_${uid()}`;
    const { slug, expiresAt } = await seedReport({ shareToken: token });

    // Now revoke it in DB.
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      await client.query(
        `UPDATE share_tokens SET revoked_at = NOW() WHERE report_slug = $1`,
        [slug],
      );
    } finally {
      await client.end();
    }

    // Use a valid HMAC cookie but the token is revoked in DB.
    const cookieValue = buildHmacCookie(slug, expiresAt!, accountId);

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}`,
      headers: { cookie: `${cookieName(slug)}=${cookieValue}` },
    });

    expect(res.statusCode, 'should 404 on DB-revoked token').toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Path 8: No token, no cookie, public=true → 200
  // ---------------------------------------------------------------------------
  it('8. no token, no cookie, reports.public=true → 200', async () => {
    const token = `tok8_${uid()}`;
    const { slug } = await seedReport({
      shareToken: token,
      public: true,
      skipShareTokenRow: true, // public reports don't need share_tokens row
    });

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}`,
    });

    expect(res.statusCode, 'should 200 for public report').toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Path 9: No token, no cookie, public=false → 404
  // ---------------------------------------------------------------------------
  it('9. no token, no cookie, reports.public=false → 404', async () => {
    const token = `tok9_${uid()}`;
    const { slug } = await seedReport({
      shareToken: token,
      public: false,
      skipShareTokenRow: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}`,
    });

    expect(res.statusCode, 'should 404 for private report without token').toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Sprint 3 retro F1: cookie name must be `wb_rt_<slug>` per spec §2 #20
  // (audit found impl used `willbuy_share_<slug>`).
  // ---------------------------------------------------------------------------
  it('F1. Set-Cookie name is wb_rt_<slug> per spec §2 #20 (not willbuy_share_)', async () => {
    const token = `tokF1_${uid()}`;
    const { slug } = await seedReport({ shareToken: token });

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}?t=${token}`,
    });

    expect(res.statusCode, 'should 302').toBe(302);

    const cookies = parseCookieHeader(res.headers['set-cookie'] as string | string[]);
    expect(cookies.length, 'at least one Set-Cookie header').toBeGreaterThan(0);

    const wbCookie = cookies.find((c) => c.startsWith(`wb_rt_${slug}=`));
    expect(wbCookie, 'Set-Cookie header starts with wb_rt_<slug>=').toBeTruthy();

    const joined = cookies.join('\n');
    expect(joined, 'cookie does NOT use legacy willbuy_share_ name').not.toMatch(
      /willbuy_share_/,
    );
  });

  // ---------------------------------------------------------------------------
  // Sprint 3 retro F2: cookie Max-Age must be capped at 2 hours (7200s) per
  // spec §2 #20 — even when the underlying token's expires_at is 90 days out.
  // The underlying TOKEN expiry stays long; only the COOKIE is capped.
  // ---------------------------------------------------------------------------
  it('F2. Set-Cookie Max-Age is capped at 7200s even with 90-day token expiry', async () => {
    const token = `tokF2_${uid()}`;
    // seedReport defaults the share_tokens row's expires_at to ~90 days out.
    const { slug, expiresAt } = await seedReport({ shareToken: token });

    // Sanity: confirm the underlying token is many days out (not 2h).
    expect(expiresAt, 'token expiresAt seeded').toBeTruthy();
    const tokenSecondsOut = Math.floor((expiresAt!.getTime() - Date.now()) / 1000);
    expect(tokenSecondsOut, 'token TTL is much greater than 2h').toBeGreaterThan(
      24 * 60 * 60, // > 1 day
    );

    const res = await app.inject({
      method: 'GET',
      url: `/reports/${slug}?t=${token}`,
    });

    expect(res.statusCode, 'should 302').toBe(302);
    const cookies = parseCookieHeader(res.headers['set-cookie'] as string | string[]);
    // Match either the new (wb_rt_) or legacy (willbuy_share_) name so this
    // test surfaces the TTL bug independently of the F1 rename status.
    const shareCookie = cookies.find(
      (c) => c.startsWith(`wb_rt_${slug}=`) || c.startsWith(`willbuy_share_${slug}=`),
    );
    expect(shareCookie, 'share-token cookie present').toBeTruthy();

    const maxAgeMatch = shareCookie!.match(/Max-Age=(\d+)/i);
    expect(maxAgeMatch, 'Max-Age attribute present').toBeTruthy();
    const maxAge = Number(maxAgeMatch![1]);
    expect(maxAge, 'Max-Age capped at 2h (7200s) per spec §2 #20').toBe(7200);
  });
});
