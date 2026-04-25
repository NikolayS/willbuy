import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sensible from '@fastify/sensible';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import Stripe from 'stripe';

import type { Env } from './env.js';
import { buildLogger } from './logger.js';
import { initPacks } from './billing/packs.js';
import { registerStudiesRoutes } from './routes/studies.js';
import { registerReportsRoutes } from './routes/reports.js';
import { registerCheckoutRoutes } from './routes/checkout.js';
import { registerStripeWebhookRoute } from './routes/stripe-webhook.js';

const here = dirname(fileURLToPath(import.meta.url));
// dist/ when built, src/ when run via tsx — both are one level below apps/api.
const pkgPath = resolve(here, '..', 'package.json');
const pkgVersion = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;

export interface BuildServerOptions {
  env: Env;
  /**
   * Optional Stripe client override — used in tests to inject a stub so no
   * real Stripe API calls are made. When omitted, a real Stripe client is
   * constructed from env.STRIPE_SECRET_KEY.
   */
  stripe?: Stripe;
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const logger = buildLogger({
    level: opts.env.LOG_LEVEL,
    urlHashSalt: opts.env.URL_HASH_SALT,
  });

  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: opts.env.LOG_LEVEL === 'silent',
  });

  await app.register(sensible);

  // Postgres connection pool — shared across all routes.
  const pool = new Pool({ connectionString: opts.env.DATABASE_URL });

  // Initialize credit-pack tiers with price IDs from env (§5.6, issue #36).
  initPacks({
    starterPriceId: opts.env.STRIPE_PRICE_ID_STARTER,
    growthPriceId: opts.env.STRIPE_PRICE_ID_GROWTH,
    scalePriceId: opts.env.STRIPE_PRICE_ID_SCALE,
  });

  // Stripe client — test mode (STRIPE_SECRET_KEY starts with sk_test_ in test mode).
  // opts.stripe overrides for test-mode stub injection (no real API calls in CI).
  const stripe = opts.stripe ?? new Stripe(opts.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    version: pkgVersion,
  }));

  // Wire authenticated routes.
  await registerStudiesRoutes(app, pool, opts.env);

  // Wire public report route (§5.12 share-token cookie redirect, issue #76).
  await registerReportsRoutes(app, pool, opts.env.SHARE_TOKEN_HMAC_KEY);

  // Wire Stripe Checkout (authenticated) + webhook (unauthenticated) routes (§4.1, issue #36).
  await registerCheckoutRoutes(app, pool, opts.env, stripe);
  await registerStripeWebhookRoute(app, pool, stripe, opts.env.STRIPE_WEBHOOK_SECRET);

  // Close pool on server shutdown.
  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
