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
