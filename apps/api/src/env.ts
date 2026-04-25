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
