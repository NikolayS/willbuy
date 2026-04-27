import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/env.js';

const BASE_ENV = {
  URL_HASH_SALT: 'a'.repeat(32),
  DATABASE_URL: 'postgres://localhost/willbuy_test',
};

describe('env validation (spec §4.1, CLAUDE.md zod-at-boundaries)', () => {
  it('accepts a valid env with a 32-char salt', () => {
    const parsed = parseEnv(BASE_ENV);
    expect(parsed.PORT).toBe(3000);
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.URL_HASH_SALT).toBe('a'.repeat(32));
    expect(parsed.DATABASE_URL).toBe('postgres://localhost/willbuy_test');
    expect(parsed.DAILY_CAP_CENTS).toBe(10_000);
  });

  it('throws when URL_HASH_SALT is missing', () => {
    expect(() => parseEnv({})).toThrow(/URL_HASH_SALT/);
  });

  it('throws when URL_HASH_SALT is shorter than 32 chars', () => {
    expect(() => parseEnv({ URL_HASH_SALT: 'short', DATABASE_URL: BASE_ENV.DATABASE_URL })).toThrow(/URL_HASH_SALT/);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => parseEnv({ URL_HASH_SALT: 'a'.repeat(32) })).toThrow(/DATABASE_URL/);
  });

  it('coerces PORT from string to number', () => {
    const parsed = parseEnv({ ...BASE_ENV, PORT: '4242' });
    expect(parsed.PORT).toBe(4242);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, LOG_LEVEL: 'shouty' }),
    ).toThrow(/LOG_LEVEL/);
  });

  it('accepts a custom DAILY_CAP_CENTS', () => {
    const parsed = parseEnv({ ...BASE_ENV, DAILY_CAP_CENTS: '5000' });
    expect(parsed.DAILY_CAP_CENTS).toBe(5000);
  });

  it('throws when DATABASE_URL is not a valid URL', () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, DATABASE_URL: 'not-a-url' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects invalid NODE_ENV value', () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV/);
  });

  it('accepts all valid NODE_ENV values', () => {
    for (const env of ['development', 'test', 'production'] as const) {
      expect(() => parseEnv({ ...BASE_ENV, NODE_ENV: env })).not.toThrow();
    }
  });

  it('rejects invalid RESEND_TEST_MODE value', () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, RESEND_TEST_MODE: 'dry-run' }),
    ).toThrow(/RESEND_TEST_MODE/);
  });

  it('STRIPE_SUCCESS_URL must be a valid URL when provided', () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, STRIPE_SUCCESS_URL: 'not-a-url' }),
    ).toThrow();
    expect(() =>
      parseEnv({ ...BASE_ENV, STRIPE_SUCCESS_URL: 'https://example.com/success' }),
    ).not.toThrow();
  });

  it('WILLBUY_METRICS_TOKEN must be at least 16 chars when provided', () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, WILLBUY_METRICS_TOKEN: 'short' }),
    ).toThrow();
    expect(() =>
      parseEnv({ ...BASE_ENV, WILLBUY_METRICS_TOKEN: 'x'.repeat(16) }),
    ).not.toThrow();
  });

  it('optional fields may be omitted without error', () => {
    // All of these are optional with defaults.
    const parsed = parseEnv(BASE_ENV);
    expect(parsed.STRIPE_SUCCESS_URL).toBeUndefined();
    expect(parsed.STRIPE_CANCEL_URL).toBeUndefined();
    expect(parsed.WILLBUY_METRICS_TOKEN).toBeUndefined();
    expect(parsed.WILLBUY_DEV_SESSION).toBeUndefined();
  });
});
