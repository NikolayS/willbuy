/**
 * scripts/api-keys-curl-evidence.ts — produces curl-style evidence for issue #81.
 *
 * Spins up Postgres, the Fastify server, seeds an account + session cookie,
 * and exercises the API-key management endpoints via app.inject(), printing
 * a transcript that mirrors what `curl -i` would show on a real instance.
 *
 * Run from apps/api:
 *   bun run scripts/api-keys-curl-evidence.ts
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

import { startPostgres, stopPostgres } from '../../../tests/helpers/start-postgres.js';
import { buildServer } from '../src/server.js';
import { encodeSession } from '../src/auth/session.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const migrationsDir = resolve(repoRoot, 'infra/migrations');

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

function curl(method: string, path: string, opts: { cookie?: string; body?: unknown }): string {
  const lines = [`$ curl -i -X ${method} https://willbuy.dev${path}`];
  if (opts.cookie) lines.push(`    -H 'Cookie: ${opts.cookie}'`);
  if (opts.body) {
    lines.push(`    -H 'Content-Type: application/json'`);
    lines.push(`    -d '${JSON.stringify(opts.body)}'`);
  }
  return lines.join(' \\\n');
}

const SESSION_HMAC_KEY = 'evidence_hmac_key_at_least_32_characters_long_xyz';

async function main(): Promise<void> {
  const dockerCheck = spawnSync('docker', ['version'], { encoding: 'utf8' });
  if (dockerCheck.status !== 0) {
    console.error('Docker not available; aborting');
    process.exit(1);
  }
  const pg = await startPostgres({ containerPrefix: 'willbuy-evidence-' });
  try {
    await applyMigrations(pg.url);

    const app = await buildServer({
      env: {
        DATABASE_URL: pg.url,
        URL_HASH_SALT: 'evidence_salt_at_least_32_characters_long_abc',
        SESSION_HMAC_KEY,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        RESEND_TEST_MODE: 'stub',
        STRIPE_SECRET_KEY: 'sk_test_evidence',
        STRIPE_WEBHOOK_SECRET: 'whsec_evidence',
        STRIPE_PRICE_ID_STARTER: 'price_evidence_starter',
        STRIPE_PRICE_ID_GROWTH: 'price_evidence_growth',
        STRIPE_PRICE_ID_SCALE: 'price_evidence_scale',
      } as Parameters<typeof buildServer>[0]['env'],
      resend: { callCount: 0, async sendMagicLink() {} } as unknown as Parameters<typeof buildServer>[0]['resend'],
    });

    const client = new Client({ connectionString: pg.url });
    await client.connect();
    const acc = await client.query<{ id: string }>(
      `INSERT INTO accounts (owner_email) VALUES ($1) RETURNING id`,
      ['demo@willbuy.dev'],
    );
    await client.end();
    const accountId = acc.rows[0]!.id;

    const session = encodeSession(
      {
        account_id: accountId,
        owner_email: 'demo@willbuy.dev',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      SESSION_HMAC_KEY,
    );
    const cookie = `wb_session=${session}`;

    function dump(title: string, command: string, statusCode: number, body: unknown): void {
      console.log(`\n# ${title}`);
      console.log(command);
      console.log(`HTTP/1.1 ${statusCode}`);
      console.log('Content-Type: application/json');
      console.log('');
      console.log(JSON.stringify(body, null, 2));
    }

    // 1. List (empty).
    {
      const res = await app.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { cookie },
      });
      dump(
        'List keys (initially empty)',
        curl('GET', '/api/api-keys', { cookie }),
        res.statusCode,
        res.json(),
      );
    }

    // 2. Create.
    let createdId = 0;
    let createdKey = '';
    {
      const res = await app.inject({
        method: 'POST',
        url: '/api/api-keys',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { label: 'CI deploy' },
      });
      const body = res.json<{ id: number; key: string }>();
      createdId = body.id;
      createdKey = body.key;
      dump(
        'Create key',
        curl('POST', '/api/api-keys', { cookie, body: { label: 'CI deploy' } }),
        res.statusCode,
        res.json(),
      );
    }

    // 3. List (after create).
    {
      const res = await app.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { cookie },
      });
      dump(
        'List keys (after create — full key NOT returned)',
        curl('GET', '/api/api-keys', { cookie }),
        res.statusCode,
        res.json(),
      );
    }

    // 4. Use key as Bearer (existing api-key middleware) — expect not-401.
    {
      const res = await app.inject({
        method: 'GET',
        url: '/studies/999999',
        headers: { Authorization: `Bearer ${createdKey}` },
      });
      const ok = res.statusCode !== 401;
      console.log(`\n# Bearer auth with the new key (should NOT be 401)`);
      console.log(`$ curl -i -H 'Authorization: Bearer <new-key>' https://willbuy.dev/studies/999999`);
      console.log(`HTTP/1.1 ${res.statusCode}  ${ok ? '(auth OK; 404 because no such study)' : '(FAIL: middleware rejected the key)'}`);
    }

    // 5. Revoke.
    {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/api-keys/${createdId}`,
        headers: { cookie },
      });
      dump(
        'Revoke key',
        curl('DELETE', `/api/api-keys/${createdId}`, { cookie }),
        res.statusCode,
        res.json(),
      );
    }

    // 6. List (after revoke).
    {
      const res = await app.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { cookie },
      });
      dump(
        'List keys (after revoke — revoked_at populated)',
        curl('GET', '/api/api-keys', { cookie }),
        res.statusCode,
        res.json(),
      );
    }

    // 7. Bearer auth with revoked key → 401.
    {
      const res = await app.inject({
        method: 'GET',
        url: '/studies/1',
        headers: { Authorization: `Bearer ${createdKey}` },
      });
      console.log(`\n# Bearer auth with revoked key → 401`);
      console.log(`$ curl -i -H 'Authorization: Bearer <revoked-key>' https://willbuy.dev/studies/1`);
      console.log(`HTTP/1.1 ${res.statusCode}`);
    }

    await app.close();
  } finally {
    stopPostgres(pg.container);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
