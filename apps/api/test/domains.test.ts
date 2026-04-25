/**
 * domains.test.ts — TDD acceptance tests for issue #82 (domain verification).
 *
 * Real-DB integration: spins up a Postgres 16 container via Docker, applies
 * all migrations, then runs Fastify in-process via app.inject().
 *
 * Spec ref: §2 #1 — verified-domain authorization (DNS TXT, /.well-known,
 *           <meta>) for v0.1.
 *
 * The three probe methods are exercised against:
 *   - node:dns/promises.resolveTxt — stubbed via vi.spyOn on the route's
 *     injected resolveTxt function.
 *   - HTTP (well-known + meta scrape) — stubbed via vi.spyOn on globalThis.fetch.
 *
 * The route file exports a `__test_setProbes` helper that allows the test
 * to inject mock resolveTxt / fetch implementations; this avoids relying on
 * vi.mock module hoisting which is brittle for ESM.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';

import { startPostgres, stopPostgres } from '../../../tests/helpers/start-postgres.js';
import { buildServer } from '../src/server.js';
import { encodeSession } from '../src/auth/session.js';
import { __test_setProbes, __test_resetProbes } from '../src/routes/domains.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const migrationsDir = resolve(repoRoot, 'infra/migrations');

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

const SESSION_HMAC_KEY = 'test_hmac_key_at_least_32_characters_long_abc';

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

function buildSessionCookie(accountId: string, email: string): string {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const value = encodeSession(
    { account_id: accountId, owner_email: email, expires_at: expiresAt },
    SESSION_HMAC_KEY,
  );
  return `wb_session=${value}`;
}

describeIfDocker('domains routes (issue #82, real DB)', () => {
  let container = '';
  let dbUrl = '';
  let app: FastifyInstance;
  let accountId: string;
  let cookie: string;

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-domains-test-' });
    container = pg.container;
    dbUrl = pg.url;

    await applyMigrations(dbUrl);

    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const acc = await db.query<{ id: string }>(
        `INSERT INTO accounts (owner_email) VALUES ('domains-test@example.com') RETURNING id`,
      );
      accountId = acc.rows[0]!.id;
    } finally {
      await db.end();
    }

    cookie = buildSessionCookie(accountId, 'domains-test@example.com');

    app = await buildServer({
      env: { ...BASE_ENV, DATABASE_URL: dbUrl },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    stopPostgres(container);
  });

  afterEach(() => {
    __test_resetProbes();
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC1: POST /api/domains valid → 200 with token + instructions
  // ──────────────────────────────────────────────────────────────────────────
  it('AC1: valid domain → 200, row inserted, instructions returned', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      payload: { domain: 'example.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      domain: string;
      verify_token: string;
      methods: { dns: string; well_known: string; meta: string };
    }>();
    expect(body.domain).toBe('example.com');
    expect(body.verify_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.methods.dns).toContain(`willbuy-verify=${body.verify_token}`);
    expect(body.methods.well_known).toContain('/.well-known/willbuy-verify');
    expect(body.methods.meta).toContain(`content="${body.verify_token}"`);

    // Row in DB.
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const r = await db.query(
        `SELECT verify_token FROM domain_verifications WHERE account_id = $1 AND domain = $2`,
        [accountId, 'example.com'],
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].verify_token).toBe(body.verify_token);
    } finally {
      await db.end();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC2: invalid domain → 400
  // ──────────────────────────────────────────────────────────────────────────
  it('AC2: invalid domain → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'not a domain' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC3: no session → 401
  // ──────────────────────────────────────────────────────────────────────────
  it('AC3: missing session cookie → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'example.com' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('AC3b: verify endpoint missing session → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/example.com/verify',
    });
    expect(res.statusCode).toBe(401);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC4: TXT record matches → verified=true, method=dns
  // ──────────────────────────────────────────────────────────────────────────
  it('AC4: DNS TXT record contains willbuy-verify=<token> → verified=true via dns', async () => {
    // Create challenge.
    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'dns-test.example' },
    });
    const { verify_token } = created.json<{ verify_token: string }>();

    // Mock probes: TXT returns the token; HTTP returns nothing useful.
    __test_setProbes({
      resolveTxt: async () => [[`willbuy-verify=${verify_token}`]],
      fetch: async () => {
        throw new Error('should not be called when DNS matches first');
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/dns-test.example/verify',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ verified: boolean; method: string }>();
    expect(body.verified).toBe(true);
    expect(body.method).toBe('dns');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC5: /.well-known returns the token → verified=true via well_known
  // ──────────────────────────────────────────────────────────────────────────
  it('AC5: /.well-known/willbuy-verify body equals token → verified=true via well_known', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'wellknown-test.example' },
    });
    const { verify_token } = created.json<{ verify_token: string }>();

    __test_setProbes({
      resolveTxt: async () => {
        throw new Error('ENOTFOUND'); // DNS fails
      },
      fetch: async (url: string) => {
        if (String(url).includes('/.well-known/willbuy-verify')) {
          return new Response(verify_token, { status: 200 });
        }
        return new Response('<html></html>', { status: 200 });
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/wellknown-test.example/verify',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ verified: boolean; method: string }>();
    expect(body.verified).toBe(true);
    expect(body.method).toBe('well_known');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC6: <meta> tag scrape → verified=true via meta
  // ──────────────────────────────────────────────────────────────────────────
  it('AC6: HTML root contains <meta name="willbuy-verify"> → verified=true via meta', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'meta-test.example' },
    });
    const { verify_token } = created.json<{ verify_token: string }>();

    __test_setProbes({
      resolveTxt: async () => {
        throw new Error('ENOTFOUND');
      },
      fetch: async (url: string) => {
        if (String(url).includes('/.well-known/willbuy-verify')) {
          return new Response('not found', { status: 404 });
        }
        // Root HTML includes the meta tag.
        const html = `<html><head><meta name="willbuy-verify" content="${verify_token}"></head><body></body></html>`;
        return new Response(html, { status: 200 });
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/meta-test.example/verify',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ verified: boolean; method: string }>();
    expect(body.verified).toBe(true);
    expect(body.method).toBe('meta');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC7: nothing matches → verified=false, last_checked_at updated
  // ──────────────────────────────────────────────────────────────────────────
  it('AC7: no probe matches → verified=false, last_checked_at updated', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'fail-test.example' },
    });

    __test_setProbes({
      resolveTxt: async () => [[`unrelated`]],
      fetch: async () => new Response('nope', { status: 404 }),
    });

    const before = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/fail-test.example/verify',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ verified: boolean }>();
    expect(body.verified).toBe(false);

    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const r = await db.query<{ last_checked_at: Date | null; verified_at: Date | null }>(
        `SELECT last_checked_at, verified_at FROM domain_verifications
          WHERE account_id = $1 AND domain = $2`,
        [accountId, 'fail-test.example'],
      );
      expect(r.rows[0]!.verified_at).toBeNull();
      expect(r.rows[0]!.last_checked_at).not.toBeNull();
      expect(r.rows[0]!.last_checked_at!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    } finally {
      await db.end();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC8: success → accounts.verified_domains array contains the new domain
  // ──────────────────────────────────────────────────────────────────────────
  it('AC8: on success, accounts.verified_domains is appended', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'verified-list-test.example' },
    });
    const { verify_token } = created.json<{ verify_token: string }>();

    __test_setProbes({
      resolveTxt: async () => [[`willbuy-verify=${verify_token}`]],
      fetch: async () => new Response('', { status: 404 }),
    });

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/domains/verified-list-test.example/verify',
      headers: { cookie },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json<{ verified: boolean }>().verified).toBe(true);

    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const r = await db.query<{ verified_domains: string[] }>(
        `SELECT verified_domains FROM accounts WHERE id = $1`,
        [accountId],
      );
      expect(r.rows[0]!.verified_domains).toContain('verified-list-test.example');
    } finally {
      await db.end();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC9: probe timeout — does not hang
  // ──────────────────────────────────────────────────────────────────────────
  it('AC9: probes time out at 5s and request returns within ~6s', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'timeout-test.example' },
    });

    // Make all probes hang forever — the route should bail at 5s per probe.
    __test_setProbes({
      resolveTxt: () => new Promise(() => { /* never resolves */ }),
      fetch: () => new Promise(() => { /* never resolves */ }),
    });

    const start = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/timeout-test.example/verify',
      headers: { cookie },
    });
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(200);
    expect(res.json<{ verified: boolean }>().verified).toBe(false);
    // Strict per-probe 5s timeout, three probes can run in parallel,
    // so total should be well under ~6s.
    expect(elapsed).toBeLessThan(6500);
  }, 15_000);

  // ──────────────────────────────────────────────────────────────────────────
  // AC10 (SEC-1): HTTPS-only, no http:// fallback.
  // Spec ref: issue #104 SEC-1 — active-MITM on the http leg can mint a
  // fake "verified" status. If the user's domain has no TLS, they must use
  // the DNS TXT method.
  // ──────────────────────────────────────────────────────────────────────────
  it('AC10 (SEC-1): https-only — when https throws ECONNREFUSED, no http fallback is attempted', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'sec1-https-only.example' },
    });

    const calls: string[] = [];
    __test_setProbes({
      resolveTxt: async () => {
        throw new Error('ENOTFOUND');
      },
      fetch: async (url) => {
        calls.push(String(url));
        // Simulate https refusing connection.
        const err = new Error('connect ECONNREFUSED 127.0.0.1:443') as Error & {
          code?: string;
        };
        err.code = 'ECONNREFUSED';
        throw err;
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/sec1-https-only.example/verify',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ verified: boolean }>().verified).toBe(false);
    // Every fetched URL must be https; we must not have fallen back to http.
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) {
      expect(url.startsWith('https://')).toBe(true);
      expect(url.startsWith('http://')).toBe(false);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC11 (SEC-2): meta probe rejects cross-eTLD+1 redirects.
  // Spec ref: issue #104 SEC-2 — `redirect: 'follow'` accepted the verify
  // token from whatever URL fetch landed on, including foreign eTLD+1s.
  // We adopt `redirect: 'manual'` to match probeWellKnown.
  // ──────────────────────────────────────────────────────────────────────────
  it('AC11 (SEC-2): meta probe with 302 to different eTLD+1 → verified=false (no token leak)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'sec2-redirect.example' },
    });
    const { verify_token } = created.json<{ verify_token: string }>();

    __test_setProbes({
      resolveTxt: async () => {
        throw new Error('ENOTFOUND');
      },
      fetch: async (url, init) => {
        // /.well-known returns 404 — so well_known probe fails.
        if (String(url).includes('/.well-known/willbuy-verify')) {
          return new Response('not found', { status: 404 });
        }
        // Root request — model what would happen on a real network:
        //   - If the route asks for redirect: 'manual', it sees the 3xx itself
        //     and must bail (the post-fix correct behavior).
        //   - If the route asks for redirect: 'follow', the network library
        //     transparently follows to attacker.example and returns the
        //     attacker's 200 response — including the token. (the pre-fix bug)
        const attackerHtml = `<html><head><meta name="willbuy-verify" content="${verify_token}"></head></html>`;
        if (init && init.redirect === 'manual') {
          return new Response('', {
            status: 302,
            headers: { location: 'https://attacker.example/' },
          });
        }
        // redirect: 'follow' (or default) — the attacker's page is returned.
        return new Response(attackerHtml, { status: 200 });
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/sec2-redirect.example/verify',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    // The route MUST refuse to honor a redirect, even though the redirected
    // body contains the token.
    expect(res.json<{ verified: boolean }>().verified).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC12 (N1): __test_setProbes is a no-op (or throws) when NODE_ENV !== 'test'.
  // Spec ref: issue #104 N1 — env-gate the test seam (mirrors the
  // WILLBUY_DEV_SESSION pattern in routes/auth.ts).
  // ──────────────────────────────────────────────────────────────────────────
  it('AC12 (N1): __test_setProbes is no-op (or throws) outside NODE_ENV=test', async () => {
    // Create a challenge.
    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { 'content-type': 'application/json', cookie },
      payload: { domain: 'n1-guard.example' },
    });
    const { verify_token } = created.json<{ verify_token: string }>();

    // First reset to defaults (real DNS / real fetch).
    __test_resetProbes();

    // Now flip NODE_ENV to 'production' and try to install a malicious probe
    // that would mint a fake DNS verification. The guard should make this
    // a no-op or throw.
    const originalNodeEnv = process.env.NODE_ENV;
    let injectedThrew = false;
    try {
      process.env.NODE_ENV = 'production';
      try {
        __test_setProbes({
          resolveTxt: async () => [[`willbuy-verify=${verify_token}`]],
          fetch: async () => new Response(verify_token, { status: 200 }),
        });
      } catch {
        injectedThrew = true;
      }
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    // Run verify WITHOUT installing any further probes. If the guard worked,
    // the defaults (real DNS / real fetch) are still in effect; for a
    // non-existent .example domain, both fail → verified=false.
    // If the guard FAILED, the malicious probe is live → verified=true.
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/n1-guard.example/verify',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ verified: boolean }>().verified).toBe(false);
    // The injection must have either thrown, or been a silent no-op (both
    // acceptable; what's not acceptable is letting the bad probes through).
    expect(typeof injectedThrew).toBe('boolean');
  }, 30_000);
});
