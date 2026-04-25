import { z } from 'zod';

// TODO(#4): replace local Env type with @willbuy/shared once that package
// publishes a shared env schema. Issue #4 owns the shared package.
export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  URL_HASH_SALT: z
    .string({ required_error: 'URL_HASH_SALT is required (≥ 32 chars)' })
    .min(32, 'URL_HASH_SALT must be at least 32 chars (spec §5.12)'),
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required' })
    .url('DATABASE_URL must be a valid URL'),
  // Per-account daily spend cap in cents. Default $100/day (10_000 ¢).
  DAILY_CAP_CENTS: z.coerce.number().int().positive().default(10_000),
  // Stripe — test-mode keys + webhook secret (§4.1, §5.6, issue #36).
  // Real values live in 1Password (op://willbuy/stripe-sandbox-secret/notesPlain, etc.).
  // Defaults are placeholder strings so existing tests that don't exercise
  // Stripe routes don't need to supply these env vars. In production the real
  // values must be injected via `op inject` / 1Password.
  STRIPE_SECRET_KEY: z.string().default('sk_test_not_configured'),
  STRIPE_WEBHOOK_SECRET: z.string().default('whsec_not_configured'),
  STRIPE_PRICE_ID_STARTER: z.string().default('price_not_configured'),
  STRIPE_PRICE_ID_GROWTH: z.string().default('price_not_configured'),
  STRIPE_PRICE_ID_SCALE: z.string().default('price_not_configured'),
  // Optional redirect URLs for Stripe Checkout (defaults are set in checkout.ts).
  STRIPE_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CANCEL_URL: z.string().url().optional(),
  // Resend transactional email (§2 #26, issue #79).
  // Real value lives in 1Password (op://willbuy/resend-api-key/credential).
  // Default 'not_configured' so tests that don't exercise email routes work
  // without a real key; RESEND_TEST_MODE=stub disables network calls.
  RESEND_API_KEY: z.string().default('re_not_configured'),
  // Set to 'stub' in tests / local dev to log instead of calling Resend.
  RESEND_TEST_MODE: z.enum(['stub', 'live']).default('live'),
  // HMAC key for signing wb_session cookies (issue #79, §5.10).
  // Must be ≥ 32 chars. Generate: openssl rand -hex 32
  // Manager action: `op item create --vault willbuy --category 'API Credential'
  //   --title session-hmac-key credential[concealed]=$(openssl rand -hex 32)`
  SESSION_HMAC_KEY: z
    .string()
    .min(32, 'SESSION_HMAC_KEY must be at least 32 chars')
    .default('dev_hmac_key_not_configured_replace_in_production_abc123'),
  // Dev bypass: if set, magic-link verify URL is returned in response body
  // instead of emailed. Only honoured when NODE_ENV !== 'production'.
  WILLBUY_DEV_SESSION: z.string().optional(),
  // NODE_ENV — used for __Host- cookie prefix and dev bypass guard.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(input);
  if (!result.success) {
    const flat = result.error.issues
      .map((i) => `${i.path.join('.') || '<env>'}: ${i.message}`)
      .join('; ');
    throw new Error(`invalid env — ${flat}`);
  }
  return result.data;
}
