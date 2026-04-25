/**
 * stripe.test.ts — TDD acceptance suite for issues #36 and #73.
 *
 * Tests §5.6 credit-pack tiers, §16 idempotent webhook, §4.1 Stripe Checkout.
 * Issue #73 adds: Stripe try/catch hardening (502 on StripeAPIError).
 *
 * Real-DB integration via startPostgres helper.
 * Stripe API calls are stubbed — no real Stripe API calls in CI.
 *
 * Spec refs: §5.6, §16, §4.1.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import Stripe from 'stripe';

import { startPostgres, stopPostgres } from '../../../tests/helpers/start-postgres.js';
import { buildServer } from '../src/server.js';
import { PACKS } from '../src/billing/packs.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const migrationsDir = resolve(repoRoot, 'infra/migrations');

// ---------------------------------------------------------------------------
// Docker availability guard
// ---------------------------------------------------------------------------

const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
const dockerAvailable = dockerCheck.status === 0;
const describeIfDocker = dockerAvailable ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Build a Stripe webhook signature header (same algorithm Stripe uses).
// https://stripe.com/docs/webhooks/signatures
function buildStripeSignature(payload: string, secret: string, ts?: number): string {
  const timestamp = ts ?? Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${payload}`;
  const hmac = createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${timestamp},v1=${hmac}`;
}

// Build a minimal `checkout.session.completed` event payload.
function buildCheckoutEvent(opts: {
  eventId: string;
  accountId: string;
  packId: string;
}): string {
  return JSON.stringify({
    id: opts.eventId,
    type: 'checkout.session.completed',
    object: 'event',
    data: {
      object: {
        id: `cs_test_${opts.eventId}`,
        object: 'checkout.session',
        client_reference_id: opts.accountId,
        metadata: { pack_id: opts.packId },
        payment_status: 'paid',
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stripe stub — avoids real Stripe API calls in CI.
// webhooks.constructEvent is re-implemented locally so signature tests work.
// ---------------------------------------------------------------------------

const STUB_CHECKOUT_URL = 'https://checkout.stripe.com/pay/cs_test_stub_session_url';

function buildStripeStub(): Stripe {
  return {
    checkout: {
      sessions: {
        create: async () => ({
          id: `cs_test_stub_${Date.now()}`,
          url: STUB_CHECKOUT_URL,
          object: 'checkout.session',
        }),
      },
    },
    webhooks: {
      // Re-implement constructEvent so real HMAC verification runs but no
      // network call is made.
      constructEvent: (payload: string, sig: string, secret: string): Stripe.Event => {
        // Parse t= and v1= from header.
        const parts = Object.fromEntries(
          sig.split(',').map((p) => p.split('=')),
        ) as Record<string, string>;
        const ts = parts['t'];
        const v1 = parts['v1'];
        if (!ts || !v1) throw new Error('invalid stripe-signature format');
        const expected = createHmac('sha256', secret)
          .update(`${ts}.${payload}`)
          .digest('hex');
        if (expected !== v1) {
          const err = new Error('No signatures found matching the expected signature for payload');
          (err as Error & { type: string }).type = 'StripeSignatureVerificationError';
          throw err;
        }
        // Parse and return the event — safe for our test payloads.
        return JSON.parse(payload) as Stripe.Event;
      },
    },
  } as unknown as Stripe;
}

describeIfDocker('Stripe Checkout + webhook (issue #36, real DB)', () => {
  let pgContainer = '';
  let dbUrl = '';
  let app: FastifyInstance;
  let accountId: bigint;
  const apiKey = 'sk_live_stripe_test_key_36abcd';
  const webhookSecret = 'whsec_test_secret_for_issue_36';

  beforeAll(async () => {
    const pg = await startPostgres({ containerPrefix: 'willbuy-stripe-test-' });
    pgContainer = pg.container;
    dbUrl = pg.url;

    await applyMigrations(dbUrl);

    // Seed account + API key.
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const acc = await client.query<{ id: string }>(
        `INSERT INTO accounts (owner_email) VALUES ('stripe-test@example.com') RETURNING id`,
      );
      accountId = BigInt(acc.rows[0]!.id);

      await client.query(
        `INSERT INTO api_keys (account_id, key_hash, prefix) VALUES ($1, $2, $3)`,
        [String(accountId), sha256hex(apiKey), 'sk_live_st'],
      );
    } finally {
      await client.end();
    }

    // Build server with Stripe stub injected (no real Stripe API calls in CI).
    app = await buildServer({
      env: {
        PORT: 0,
        LOG_LEVEL: 'silent',
        URL_HASH_SALT: 'x'.repeat(32),
        DATABASE_URL: dbUrl,
        DAILY_CAP_CENTS: 10_000,
        STRIPE_SECRET_KEY: 'sk_test_fake_not_used_because_stub_injected',
        STRIPE_WEBHOOK_SECRET: webhookSecret,
        STRIPE_PRICE_ID_STARTER: 'price_test_starter_1000',
        STRIPE_PRICE_ID_GROWTH: 'price_test_growth_4000',
        STRIPE_PRICE_ID_SCALE: 'price_test_scale_15000',
      },
      stripe: buildStripeStub(),
    });
  });

  afterAll(async () => {
    await app.close();
    stopPostgres(pgContainer);
  });

  // -------------------------------------------------------------------------
  // PACKS unit test — no DB needed
  // -------------------------------------------------------------------------

  it('PACKS has starter / growth / scale with correct cents and price_ids', () => {
    expect(PACKS.starter.cents).toBe(2900);
    expect(PACKS.starter.usd).toBe(29);
    expect(PACKS.growth.cents).toBe(9900);
    expect(PACKS.growth.usd).toBe(99);
    expect(PACKS.scale.cents).toBe(29900);
    expect(PACKS.scale.usd).toBe(299);
    // price_ids come from env; if env is set they are non-empty strings.
    expect(typeof PACKS.starter.price_id).toBe('string');
  });

  // -------------------------------------------------------------------------
  // POST /checkout/sessions
  // -------------------------------------------------------------------------

  it('POST /checkout/sessions with valid pack_id returns 200 + url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout/sessions',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { pack_id: 'starter' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string };
    expect(typeof body.url).toBe('string');
    expect(body.url.length).toBeGreaterThan(0);
    // Stub returns the fixed test URL.
    expect(body.url).toBe(STUB_CHECKOUT_URL);
  });

  it('POST /checkout/sessions with invalid pack_id returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout/sessions',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { pack_id: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /checkout/sessions without auth returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout/sessions',
      payload: { pack_id: 'starter' },
    });
    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // POST /stripe/webhook — happy path
  // -------------------------------------------------------------------------

  it('webhook checkout.session.completed inserts top_up ledger row', async () => {
    const eventId = `evt_test_${uid()}`;
    const payload = buildCheckoutEvent({
      eventId,
      accountId: String(accountId),
      packId: 'starter',
    });
    const sig = buildStripeSignature(payload, webhookSecret);

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: {
        'stripe-signature': sig,
        'content-type': 'application/json',
      },
      payload,
    });
    expect(res.statusCode).toBe(200);

    // Verify ledger row.
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const rows = await client.query<{
        kind: string;
        cents: number;
        idempotency_key: string;
      }>(
        `SELECT kind, cents, idempotency_key
           FROM credit_ledger
          WHERE account_id = $1 AND idempotency_key = $2`,
        [String(accountId), eventId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.kind).toBe('top_up');
      expect(rows.rows[0]!.cents).toBe(PACKS.starter.cents);
    } finally {
      await client.end();
    }
  });

  // -------------------------------------------------------------------------
  // Idempotency: 5x retry with same event.id → exactly 1 ledger row (BLOCKING)
  // -------------------------------------------------------------------------

  it('webhook idempotency: 5 retries of same event.id → exactly 1 ledger row', async () => {
    const eventId = `evt_idem_${uid()}`;
    const payload = buildCheckoutEvent({
      eventId,
      accountId: String(accountId),
      packId: 'growth',
    });
    const sig = buildStripeSignature(payload, webhookSecret);

    // Fire the same webhook 5 times.
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: {
          'stripe-signature': sig,
          'content-type': 'application/json',
        },
        payload,
      });
      // All requests should return 200 (idempotent, not an error on duplicate).
      expect(res.statusCode).toBe(200);
    }

    // Verify exactly 1 row in ledger.
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const rows = await client.query<{ cnt: string }>(
        `SELECT count(*) AS cnt
           FROM credit_ledger
          WHERE account_id = $1 AND idempotency_key = $2`,
        [String(accountId), eventId],
      );
      expect(Number(rows.rows[0]!.cnt)).toBe(1);
    } finally {
      await client.end();
    }
  });

  // -------------------------------------------------------------------------
  // Webhook: invalid signature → 400, no ledger write
  // -------------------------------------------------------------------------

  it('webhook with invalid signature → 400, no ledger write', async () => {
    const eventId = `evt_badsig_${uid()}`;
    const payload = buildCheckoutEvent({
      eventId,
      accountId: String(accountId),
      packId: 'scale',
    });
    // Wrong secret.
    const badSig = buildStripeSignature(payload, 'whsec_wrong_secret');

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: {
        'stripe-signature': badSig,
        'content-type': 'application/json',
      },
      payload,
    });
    expect(res.statusCode).toBe(400);

    // No ledger row inserted.
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const rows = await client.query<{ cnt: string }>(
        `SELECT count(*) AS cnt FROM credit_ledger WHERE idempotency_key = $1`,
        [eventId],
      );
      expect(Number(rows.rows[0]!.cnt)).toBe(0);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Issue #73 — Stripe try/catch hardening (no Docker required).
//
// Verifies that when stripe.checkout.sessions.create throws a StripeAPIError,
// POST /checkout/sessions returns 502 with a generic user-facing message and
// does NOT leak internal Stripe error details to the client.
// ---------------------------------------------------------------------------

describe('Stripe checkout error-handling (issue #73)', () => {
  let app: FastifyInstance;
  const apiKey = 'sk_live_stripe_error_test_key_73xx';
  const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

  beforeAll(async () => {
    // Start a real Postgres via Docker if available; otherwise skip.
    // This block is guarded by the same dockerAvailable flag used above.
  });

  // Use a separate describe that is conditionally skipped based on Docker.
  it.skipIf(!dockerAvailable)(
    'POST /checkout/sessions returns 502 when stripe.checkout.sessions.create throws StripeAPIError',
    async () => {
      // Build a stub Stripe that throws StripeAPIError on checkout creation.
      const stripeErr = new Stripe.errors.StripeAPIError({
        message: 'stripe internal details that must not leak',
        type: 'api_error',
      });

      const throwingStripe = {
        checkout: {
          sessions: {
            create: async () => {
              throw stripeErr;
            },
          },
        },
        webhooks: {
          constructEvent: () => {
            throw new Error('not used in this test');
          },
        },
      } as unknown as Stripe;

      // Spin up a fresh server instance for this test.
      const pg = await startPostgres({ containerPrefix: 'willbuy-stripe-err-test-' });
      try {
        // Apply migrations.
        const migFiles = readdirSync(migrationsDir)
          .filter((f) => /^\d{4}_.*\.sql$/.test(f))
          .sort();
        const pgClient = new Client({ connectionString: pg.url });
        await pgClient.connect();
        for (const f of migFiles) {
          await pgClient.query(readFileSync(resolve(migrationsDir, f), 'utf8'));
        }
        await pgClient.end();

        // Seed account + api-key.
        const seedClient = new Client({ connectionString: pg.url });
        await seedClient.connect();
        const acc = await seedClient.query<{ id: string }>(
          `INSERT INTO accounts (owner_email) VALUES ('err-test@example.com') RETURNING id`,
        );
        await seedClient.query(
          `INSERT INTO api_keys (account_id, key_hash, prefix) VALUES ($1, $2, $3)`,
          [String(acc.rows[0]!.id), sha256hex(apiKey), 'sk_live_se'],
        );
        await seedClient.end();

        app = await buildServer({
          env: {
            PORT: 0,
            LOG_LEVEL: 'silent',
            URL_HASH_SALT: 'x'.repeat(32),
            DATABASE_URL: pg.url,
            DAILY_CAP_CENTS: 10_000,
            STRIPE_SECRET_KEY: 'sk_test_fake_not_used_because_stub_injected',
            STRIPE_WEBHOOK_SECRET: 'whsec_not_used',
            STRIPE_PRICE_ID_STARTER: 'price_test_starter',
            STRIPE_PRICE_ID_GROWTH: 'price_test_growth',
            STRIPE_PRICE_ID_SCALE: 'price_test_scale',
          },
          stripe: throwingStripe,
        });

        const res = await app.inject({
          method: 'POST',
          url: '/checkout/sessions',
          headers: { authorization: `Bearer ${apiKey}` },
          payload: { pack_id: 'starter' },
        });

        // Must return 502, not 500 and not a Stripe internal message.
        expect(res.statusCode).toBe(502);
        const body = res.json() as { error: string };
        expect(body.error).toBe('payment provider unavailable, try again');
        // Stripe internal message must NOT appear in the response body.
        expect(res.body).not.toContain('stripe internal details that must not leak');
      } finally {
        await app?.close();
        stopPostgres(pg.container);
      }
    },
  );
});
