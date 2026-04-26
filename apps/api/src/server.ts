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
import { buildResendClient, type ResendClient } from './email/resend.js';
import { registerStudiesRoutes } from './routes/studies.js';
import { registerReportsRoutes } from './routes/reports.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCheckoutRoutes } from './routes/checkout.js';
import { registerDomainsRoutes } from './routes/domains.js';
import { registerStripeWebhookRoute } from './routes/stripe-webhook.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerMetricsRoute } from './routes/metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
// dist/ when built, src/ when run via tsx — both are one level below apps/api.
const pkgPath = resolve(here, '..', 'package.json');
const pkgVersion = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;

export interface BuildServerOptions {
  /**
   * Parsed environment. May be a full Env or a partial record — missing fields
   * fall back to the schema defaults defined in env.ts (e.g. RESEND_TEST_MODE,
   * SESSION_HMAC_KEY). This keeps older tests that only supply a subset of
   * env vars from breaking after new optional-but-defaulted fields are added.
   */
  env: Partial<Env> & Pick<Env, 'DATABASE_URL' | 'URL_HASH_SALT'>;
  /**
   * Optional Stripe client override — used in tests to inject a stub so no
   * real Stripe API calls are made. When omitted, a real Stripe client is
   * constructed from env.STRIPE_SECRET_KEY.
   */
  stripe?: Stripe;
  /**
   * Optional Resend client override — used in tests to inject a stub so no
   * real emails are sent. When omitted, a client is built from env vars.
   */
  resend?: ResendClient;
}

// Default values for fields added after initial release — keeps older test
// fixtures that supply only a subset of env vars working without modification.
const ENV_DEFAULTS: Partial<Env> = {
  RESEND_API_KEY: 're_not_configured',
  RESEND_TEST_MODE: 'stub',
  SESSION_HMAC_KEY: 'dev_hmac_key_not_configured_replace_in_production_abc123',
  NODE_ENV: 'development',
};

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  // Merge in defaults for any missing env fields.
  const env: Env = { ...ENV_DEFAULTS, ...opts.env } as Env;

  const logger = buildLogger({
    level: env.LOG_LEVEL,
    urlHashSalt: env.URL_HASH_SALT,
  });

  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: env.LOG_LEVEL === 'silent',
  });

  await app.register(sensible);

  // Wire /metrics + onRequest/onResponse hooks FIRST so the request-duration
  // histogram captures every subsequent route (issue #119, spec §5.14).
  await registerMetricsRoute(app, env.WILLBUY_METRICS_TOKEN);

  // Postgres connection pool — shared across all routes.
  const pool = new Pool({ connectionString: env.DATABASE_URL });

  // Initialize credit-pack tiers with price IDs from env (§5.6, issue #36).
  initPacks({
    starterPriceId: env.STRIPE_PRICE_ID_STARTER,
    growthPriceId: env.STRIPE_PRICE_ID_GROWTH,
    scalePriceId: env.STRIPE_PRICE_ID_SCALE,
  });

  // Stripe client — test mode (STRIPE_SECRET_KEY starts with sk_test_ in test mode).
  // opts.stripe overrides for test-mode stub injection (no real API calls in CI).
  const stripe = opts.stripe ?? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });

  // Resend email client — opts.resend overrides for test-mode stub injection.
  const resend =
    opts.resend ??
    buildResendClient({
      apiKey: env.RESEND_API_KEY,
      testMode: env.RESEND_TEST_MODE === 'stub',
    });

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    version: pkgVersion,
  }));

  // Wire auth routes (magic-link sign-in, issue #79).
  await registerAuthRoutes(app, pool, env, resend);

  // Wire domain verification routes (issue #82, §2 #1).
  await registerDomainsRoutes(app, pool, env);

  // Wire account-dashboard routes (session-cookie auth, issue #80).
  await registerDashboardRoutes(app, pool, env);

  // Wire API-key management routes (session-cookie auth, issue #81).
  await registerApiKeyRoutes(app, pool, env);

  // Wire authenticated routes.
  await registerStudiesRoutes(app, pool, env);

  // Wire public report route (§5.12 share-token cookie redirect, issue #76).
  await registerReportsRoutes(app, pool, env.SHARE_TOKEN_HMAC_KEY);

  // Wire Stripe Checkout (authenticated) + webhook (unauthenticated) routes (§4.1, issue #36).
  await registerCheckoutRoutes(app, pool, env, stripe);
  await registerStripeWebhookRoute(app, pool, stripe, env.STRIPE_WEBHOOK_SECRET);

  // Close pool on server shutdown.
  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
