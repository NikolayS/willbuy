/**
 * domains-list.test.ts — TDD acceptance tests for issue #83 (domain list page).
 *
 * Spec refs: §2 #1 (verified-domain authorization — tokens rotated on
 *            verification-list changes), §4.1 (web app — Sprint 3).
 *
 * Routes under test (NEW in this PR — must NOT exist before this commit):
 *   GET    /api/domains          — list account's domains
 *   DELETE /api/domains/:domain  — remove a domain (and from
 *                                   accounts.verified_domains)
 *
 * Both endpoints sit behind buildSessionMiddleware (wb_session cookie),
 * matching the existing POST /api/domains and POST /api/domains/:d/verify
 * routes added in PR #103 (issue #82).
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

describeIfDocker('domains list/delete routes (issue #83, real DB)', () => {
  let container = '';
  let dbUrl = '';
  let app: FastifyInstance;
  let accountIdA: string;
  let accountIdB: string;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-domains-list-test-' });
    container = pg.container;
    dbUrl = pg.url;

    await applyMigrations(dbUrl);

    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const a = await db.query<{ id: string }>(
        `INSERT INTO accounts (owner_email) VALUES ('a@example.com') RETURNING id`,
      );
      accountIdA = a.rows[0]!.id;
      const b = await db.query<{ id: string }>(
        `INSERT INTO accounts (owner_email) VALUES ('b@example.com') RETURNING id`,
      );
      accountIdB = b.rows[0]!.id;
    } finally {
      await db.end();
    }

    cookieA = buildSessionCookie(accountIdA, 'a@example.com');
    cookieB = buildSessionCookie(accountIdB, 'b@example.com');

    app = await buildServer({
      env: { ...BASE_ENV, DATABASE_URL: dbUrl },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    stopPostgres(container);
  });

  // Helpers for seeding state directly in DB so tests don't depend on probes.
  async function seed(
    accountId: string,
    rows: Array<{
      domain: string;
      verify_token: string;
      verified_at: Date | null;
      last_checked_at: Date | null;
      created_at?: Date;
    }>,
  ): Promise<void> {
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      for (const r of rows) {
        await db.query(
          `INSERT INTO domain_verifications
             (account_id, domain, verify_token, verified_at, last_checked_at, created_at)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))
           ON CONFLICT ON CONSTRAINT domain_verifications_account_domain_uniq
             DO UPDATE SET verify_token = EXCLUDED.verify_token,
                           verified_at = EXCLUDED.verified_at,
                           last_checked_at = EXCLUDED.last_checked_at`,
          [
            accountId,
            r.domain,
            r.verify_token,
            r.verified_at,
            r.last_checked_at,
            r.created_at ?? null,
          ],
        );
        if (r.verified_at) {
          await db.query(
            `UPDATE accounts
                SET verified_domains =
                  CASE
                    WHEN $2 = ANY(COALESCE(verified_domains, '{}')) THEN verified_domains
                    ELSE COALESCE(verified_domains, '{}') || ARRAY[$2]::text[]
                  END
              WHERE id = $1`,
            [accountId, r.domain],
          );
        }
      }
    } finally {
      await db.end();
    }
  }

  async function clearAll(): Promise<void> {
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      await db.query(`DELETE FROM domain_verifications`);
      await db.query(`UPDATE accounts SET verified_domains = '{}'`);
      await db.query(`DELETE FROM studies`);
    } finally {
      await db.end();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AC1: GET /api/domains → list ordered created_at DESC
  // ──────────────────────────────────────────────────────────────────────────
  it('AC1: GET /api/domains with valid session returns rows ordered by created_at DESC', async () => {
    await clearAll();
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    await seed(accountIdA, [
      {
        domain: 'older.example',
        verify_token: 'tok-older-zzzzzzzzzzzz',
        verified_at: older,
        last_checked_at: older,
        created_at: older,
      },
      {
        domain: 'newer.example',
        verify_token: 'tok-newer-zzzzzzzzzzzz',
        verified_at: null,
        last_checked_at: null,
        created_at: newer,
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/domains',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      domains: Array<{
        domain: string;
        verify_token: string;
        verified_at: string | null;
        last_checked_at: string | null;
        created_at: string;
      }>;
    }>();
    expect(body.domains).toHaveLength(2);
    expect(body.domains[0]!.domain).toBe('newer.example');
    expect(body.domains[1]!.domain).toBe('older.example');
    expect(body.domains[0]!.verified_at).toBeNull();
    expect(body.domains[1]!.verified_at).not.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC2: GET /api/domains without session → 401
  // ──────────────────────────────────────────────────────────────────────────
  it('AC2: GET /api/domains without session → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/domains' });
    expect(res.statusCode).toBe(401);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC3: cross-account isolation
  // ──────────────────────────────────────────────────────────────────────────
  it("AC3: account A cannot see account B's domains", async () => {
    await clearAll();
    await seed(accountIdA, [
      {
        domain: 'a-only.example',
        verify_token: 'tok-a-zzzzzzzzzzzzzz',
        verified_at: new Date(),
        last_checked_at: new Date(),
      },
    ]);
    await seed(accountIdB, [
      {
        domain: 'b-only.example',
        verify_token: 'tok-b-zzzzzzzzzzzzzz',
        verified_at: new Date(),
        last_checked_at: new Date(),
      },
    ]);

    const resA = await app.inject({
      method: 'GET',
      url: '/api/domains',
      headers: { cookie: cookieA },
    });
    expect(resA.statusCode).toBe(200);
    const a = resA.json<{ domains: Array<{ domain: string }> }>();
    expect(a.domains.map((d) => d.domain)).toEqual(['a-only.example']);

    const resB = await app.inject({
      method: 'GET',
      url: '/api/domains',
      headers: { cookie: cookieB },
    });
    expect(resB.statusCode).toBe(200);
    const b = resB.json<{ domains: Array<{ domain: string }> }>();
    expect(b.domains.map((d) => d.domain)).toEqual(['b-only.example']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC4: DELETE /api/domains/:domain → 204; row gone, removed from accounts.verified_domains
  // ──────────────────────────────────────────────────────────────────────────
  it('AC4: DELETE removes from domain_verifications and accounts.verified_domains', async () => {
    await clearAll();
    await seed(accountIdA, [
      {
        domain: 'remove-me.example',
        verify_token: 'tok-rm-zzzzzzzzzzzzzz',
        verified_at: new Date(),
        last_checked_at: new Date(),
      },
      {
        domain: 'keep-me.example',
        verify_token: 'tok-keep-zzzzzzzzzzzz',
        verified_at: new Date(),
        last_checked_at: new Date(),
      },
    ]);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/domains/remove-me.example',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(204);

    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const dvs = await db.query(
        `SELECT domain FROM domain_verifications WHERE account_id = $1 ORDER BY domain`,
        [accountIdA],
      );
      expect(dvs.rows.map((r) => r.domain)).toEqual(['keep-me.example']);

      const acc = await db.query<{ verified_domains: string[] }>(
        `SELECT verified_domains FROM accounts WHERE id = $1`,
        [accountIdA],
      );
      expect(acc.rows[0]!.verified_domains).toEqual(['keep-me.example']);
    } finally {
      await db.end();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC5: DELETE non-existent domain → 404
  // ──────────────────────────────────────────────────────────────────────────
  it('AC5: DELETE for a domain that does not exist → 404', async () => {
    await clearAll();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/domains/never-seen.example',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(404);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC6: DELETE on someone else's domain → 404 (no leak)
  // ──────────────────────────────────────────────────────────────────────────
  it("AC6: DELETE on another account's domain → 404 (no existence leak)", async () => {
    await clearAll();
    await seed(accountIdB, [
      {
        domain: 'b-secret.example',
        verify_token: 'tok-b2-zzzzzzzzzzzzz',
        verified_at: new Date(),
        last_checked_at: new Date(),
      },
    ]);

    // A tries to delete B's domain — must look identical to a non-existent.
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/domains/b-secret.example',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(404);

    // B's row is still intact.
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const r = await db.query(
        `SELECT 1 FROM domain_verifications WHERE account_id = $1 AND domain = $2`,
        [accountIdB, 'b-secret.example'],
      );
      expect(r.rows).toHaveLength(1);
    } finally {
      await db.end();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC7: DELETE without session → 401
  // ──────────────────────────────────────────────────────────────────────────
  it('AC7: DELETE without session → 401', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/domains/anything.example',
    });
    expect(res.statusCode).toBe(401);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC8: POST /api/domains/:domain/delete (form workaround) behaves like DELETE
  //      and redirects 302 to /dashboard/domains.
  // ──────────────────────────────────────────────────────────────────────────
  it('AC8: POST /api/domains/:domain/delete works as a form-submit DELETE (302 → /dashboard/domains)', async () => {
    await clearAll();
    await seed(accountIdA, [
      {
        domain: 'form-delete.example',
        verify_token: 'tok-fd-zzzzzzzzzzzzzz',
        verified_at: new Date(),
        last_checked_at: new Date(),
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/form-delete.example/delete',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/dashboard/domains');

    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const dvs = await db.query(
        `SELECT 1 FROM domain_verifications WHERE account_id = $1 AND domain = $2`,
        [accountIdA, 'form-delete.example'],
      );
      expect(dvs.rows).toHaveLength(0);
      const acc = await db.query<{ verified_domains: string[] }>(
        `SELECT verified_domains FROM accounts WHERE id = $1`,
        [accountIdA],
      );
      expect(acc.rows[0]!.verified_domains ?? []).not.toContain('form-delete.example');
    } finally {
      await db.end();
    }
  });
});
