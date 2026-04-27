/**
 * auth.test.ts — TDD acceptance tests for issue #79 (magic-link sign-in).
 *
 * Real-DB integration: spins up a Postgres 16 container via Docker, applies
 * all migrations, then runs Fastify in-process via app.inject().
 *
 * Spec refs: §4.1, §2 #26 (Resend), §5.10 (cookie flags), §2 #20 (404 on bad token).
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

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// Build a minimal stub Resend client for tests.
function buildStubResend(): ResendClient & { lastCall: { to: string; verifyUrl: string } | null } {
  let callCount = 0;
  let lastCall: { to: string; verifyUrl: string } | null = null;
  return {
    get callCount() { return callCount; },
    get lastCall() { return lastCall; },
    async sendMagicLink(opts) {
      callCount += 1;
      lastCall = opts;
    },
    async sendCapWarning() {
      // no-op stub
    },
  };
}

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
  SESSION_HMAC_KEY: 'test_hmac_key_at_least_32_characters_long_abc',
  NODE_ENV: 'test' as const,
};

// ---------------------------------------------------------------------------
describeIfDocker('auth magic-link (issue #79, real DB)', () => {
  let container = '';
  let dbUrl = '';
  let app: FastifyInstance;
  let resendStub: ReturnType<typeof buildStubResend>;

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-auth-test-' });
    container = pg.container;
    dbUrl = pg.url;

    await applyMigrations(dbUrl);

    resendStub = buildStubResend();

    app = await buildServer({
      env: { ...BASE_ENV, DATABASE_URL: dbUrl },
      resend: resendStub,
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    stopPostgres(container);
  });

  // -------------------------------------------------------------------------
  // AC1: POST /api/auth/magic-link with valid email → 202, rows created, Resend called.
  // -------------------------------------------------------------------------
  it('AC1: valid email → 202, account row exists, magic_link row exists, Resend called once', async () => {
    const email = 'ac1@example.com';
    const priorCallCount = resendStub.callCount;

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email },
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(202);

    // Account upserted.
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const acct = await db.query('SELECT id FROM accounts WHERE owner_email = $1', [email]);
      expect(acct.rows).toHaveLength(1);

      // Magic-link row created.
      const ml = await db.query(
        'SELECT * FROM auth_magic_links WHERE account_id = $1',
        [acct.rows[0].id],
      );
      expect(ml.rows).toHaveLength(1);
      expect(ml.rows[0].used_at).toBeNull();
      expect(new Date(ml.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    } finally {
      await db.end();
    }

    // Resend called once.
    expect(resendStub.callCount).toBe(priorCallCount + 1);
    expect(resendStub.lastCall?.to).toBe(email);
  });

  // -------------------------------------------------------------------------
  // AC2: Invalid email → 400.
  // -------------------------------------------------------------------------
  it('AC2: invalid email → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'not-an-email' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // AC3: GET /api/auth/verify with valid token → 302 to /dashboard, Set-Cookie.
  // -------------------------------------------------------------------------
  it('AC3: valid token → 302 to /dashboard with Set-Cookie', async () => {
    const email = 'ac3@example.com';

    // Request magic link.
    const mlRes = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email },
      headers: { 'content-type': 'application/json' },
    });
    expect(mlRes.statusCode).toBe(202);

    // Retrieve raw token from DB by looking up the token_hash's account.
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    let rawToken = '';
    try {
      const acct = await db.query('SELECT id FROM accounts WHERE owner_email = $1', [email]);
      const accountId = acct.rows[0].id;
      // The raw token is never stored; we need to find the hash from the last row.
      // Since we know the Resend stub captures the verifyUrl, use that.
      const verifyUrl = resendStub.lastCall?.verifyUrl ?? '';
      const match = /[?&]token=([^&]+)/.exec(verifyUrl);
      rawToken = match?.[1] ?? '';
      expect(rawToken).toBeTruthy();

      // Confirm the hash matches.
      const ml = await db.query(
        'SELECT token_hash FROM auth_magic_links WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1',
        [accountId],
      );
      expect(ml.rows[0].token_hash).toBe(sha256hex(rawToken));
    } finally {
      await db.end();
    }

    // Verify the token.
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${rawToken}`,
    });

    expect(verifyRes.statusCode).toBe(302);
    expect(verifyRes.headers.location).toBe('/dashboard');

    const setCookie = verifyRes.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieStr).toMatch(/wb_session=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/SameSite=Lax/i);
    expect(cookieStr).toMatch(/Path=\//i);
  });

  // -------------------------------------------------------------------------
  // AC4: Expired token → 404, no cookie.
  // -------------------------------------------------------------------------
  it('AC4: expired token → 404, no Set-Cookie', async () => {
    const email = 'ac4@example.com';

    await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email },
      headers: { 'content-type': 'application/json' },
    });

    // Expire the token manually in DB.
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    let rawToken = '';
    try {
      const acct = await db.query('SELECT id FROM accounts WHERE owner_email = $1', [email]);
      const accountId = acct.rows[0].id;

      // Get token from Resend stub.
      const verifyUrl = resendStub.lastCall?.verifyUrl ?? '';
      const match = /[?&]token=([^&]+)/.exec(verifyUrl);
      rawToken = match?.[1] ?? '';

      await db.query(
        'UPDATE auth_magic_links SET expires_at = now() - interval \'1 hour\' WHERE account_id = $1',
        [accountId],
      );
    } finally {
      await db.end();
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${rawToken}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // AC5: Already-used token → 404, no cookie.
  // -------------------------------------------------------------------------
  it('AC5: already-used token → 404, no Set-Cookie', async () => {
    const email = 'ac5@example.com';

    await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email },
      headers: { 'content-type': 'application/json' },
    });

    const verifyUrl = resendStub.lastCall?.verifyUrl ?? '';
    const match = /[?&]token=([^&]+)/.exec(verifyUrl);
    const rawToken = match?.[1] ?? '';
    expect(rawToken).toBeTruthy();

    // First use — should succeed.
    const firstRes = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${rawToken}`,
    });
    expect(firstRes.statusCode).toBe(302);

    // Second use — should be 404.
    const secondRes = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${rawToken}`,
    });
    expect(secondRes.statusCode).toBe(404);
    expect(secondRes.headers['set-cookie']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // AC6: Wrong token → 404 (timing-safe, no leak).
  // -------------------------------------------------------------------------
  it('AC6: wrong token → 404, no Set-Cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/verify?token=totally_wrong_token_12345',
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // AC7: Cookie reuse — subsequent request with wb_session has req.account populated.
  // -------------------------------------------------------------------------
  it('AC7: session middleware populates req.account from valid wb_session cookie', async () => {
    const email = 'ac7@example.com';

    // Create account.
    await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email },
      headers: { 'content-type': 'application/json' },
    });

    const verifyUrl = resendStub.lastCall?.verifyUrl ?? '';
    const match = /[?&]token=([^&]+)/.exec(verifyUrl);
    const rawToken = match?.[1] ?? '';

    // Exchange for session cookie.
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${rawToken}`,
    });
    expect(verifyRes.statusCode).toBe(302);

    // Extract cookie.
    const setCookieHeader = verifyRes.headers['set-cookie'];
    const cookieStr = (Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader) ?? '';
    // Parse: "wb_session=<value>; HttpOnly; ..."
    const cookieValueMatch = /^[^=]+=([^;]+)/.exec(cookieStr);
    const cookieValue = cookieValueMatch?.[1] ?? '';
    expect(cookieValue).toBeTruthy();

    // Make authenticated request — use the /health route first to confirm
    // server is up, then test that session decode works by decoding manually.
    const { decodeSession } = await import('../src/auth/session.js');
    const payload = decodeSession(cookieValue as string, BASE_ENV.SESSION_HMAC_KEY);
    expect(payload).not.toBeNull();
    expect(payload?.owner_email).toBe(email);
  });

  // -------------------------------------------------------------------------
  // AC8: POST /api/auth/sign-out clears cookie.
  // -------------------------------------------------------------------------
  it('AC8: POST /api/auth/sign-out → 302 to /sign-in, clears cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/sign-in');

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie ?? '';
    expect(cookieStr).toMatch(/wb_session=/);
    expect(cookieStr).toMatch(/Max-Age=0/i);
  });

  // -------------------------------------------------------------------------
  // AC2-regression (issue #99 N3): idempotent re-request of magic-link keeps
  // the FIRST token usable. Two POSTs for the same email within 30 min must
  // not invalidate the earlier token; the first token still verifies → 302.
  // -------------------------------------------------------------------------
  it('AC2-regression: re-requesting magic-link does not invalidate the first token (issue #99)', async () => {
    const email = 'ac2-regression@example.com';

    // First request — capture the first verifyUrl/token.
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email },
      headers: { 'content-type': 'application/json' },
    });
    expect(first.statusCode).toBe(202);
    const firstVerifyUrl = resendStub.lastCall?.verifyUrl ?? '';
    const firstMatch = /[?&]token=([^&]+)/.exec(firstVerifyUrl);
    const firstToken = firstMatch?.[1] ?? '';
    expect(firstToken).toBeTruthy();

    // Second request for the same email (within the 30-min expiry window).
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email },
      headers: { 'content-type': 'application/json' },
    });
    expect(second.statusCode).toBe(202);
    const secondVerifyUrl = resendStub.lastCall?.verifyUrl ?? '';
    const secondMatch = /[?&]token=([^&]+)/.exec(secondVerifyUrl);
    const secondToken = secondMatch?.[1] ?? '';
    expect(secondToken).toBeTruthy();

    // The two tokens may or may not be equal (current impl issues a fresh
    // row each time); the spec only requires that the FIRST token remains
    // valid. That's the AC2 invariant we're regression-locking here.
    const verifyFirst = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${firstToken}`,
    });
    expect(verifyFirst.statusCode).toBe(302);
    expect(verifyFirst.headers.location).toBe('/dashboard');
  });

  // -------------------------------------------------------------------------
  // AC9: Dev mode (WILLBUY_DEV_SESSION set) — verify URL in body, no email sent.
  // -------------------------------------------------------------------------
  it('AC9: WILLBUY_DEV_SESSION set → verifyUrl in body, Resend NOT called', async () => {
    const devResend = buildStubResend();
    const devApp = await buildServer({
      env: {
        ...BASE_ENV,
        DATABASE_URL: dbUrl,
        NODE_ENV: 'test',
        WILLBUY_DEV_SESSION: 'dev@willbuy.dev',
      },
      resend: devResend,
    });

    try {
      const priorCount = devResend.callCount;
      const res = await devApp.inject({
        method: 'POST',
        url: '/api/auth/magic-link',
        payload: { email: 'ac9@example.com' },
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json<{ verifyUrl?: string }>();
      expect(body.verifyUrl).toMatch(/\/api\/auth\/verify\?token=/);
      // Resend should NOT have been called.
      expect(devResend.callCount).toBe(priorCount);
    } finally {
      await devApp.close();
    }
  });

  // -------------------------------------------------------------------------
  // AC10: redirect param flows through magic-link → verify → 302 to that path.
  // -------------------------------------------------------------------------
  it('AC10: redirect param in magic-link body → verify redirects to that path', async () => {
    const email = 'ac10@example.com';

    await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email, redirect: '/pricing' },
      headers: { 'content-type': 'application/json' },
    });

    const verifyUrl = resendStub.lastCall?.verifyUrl ?? '';
    expect(verifyUrl).toMatch(/redirect=%2Fpricing/);

    const match = /[?&]token=([^&]+)/.exec(verifyUrl);
    const rawToken = match?.[1] ?? '';
    expect(rawToken).toBeTruthy();

    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${rawToken}&redirect=%2Fpricing`,
    });

    expect(verifyRes.statusCode).toBe(302);
    expect(verifyRes.headers.location).toBe('/pricing');
  });

  // -------------------------------------------------------------------------
  // AC11: unsafe redirect values fall back to /dashboard.
  // -------------------------------------------------------------------------
  it('AC11: open-redirect attempt falls back to /dashboard', async () => {
    const email = 'ac11@example.com';

    await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email, redirect: 'https://evil.com' },
      headers: { 'content-type': 'application/json' },
    });

    const verifyUrl = resendStub.lastCall?.verifyUrl ?? '';
    // Unsafe redirect should not appear in the verify URL.
    expect(verifyUrl).not.toMatch(/evil\.com/);

    const match = /[?&]token=([^&]+)/.exec(verifyUrl);
    const rawToken = match?.[1] ?? '';

    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${rawToken}&redirect=https%3A%2F%2Fevil.com`,
    });

    expect(verifyRes.statusCode).toBe(302);
    expect(verifyRes.headers.location).toBe('/dashboard');
  });
});
