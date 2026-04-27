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

  it('throws when SESSION_HMAC_KEY is shorter than 32 chars', () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, SESSION_HMAC_KEY: 'too-short' }),
    ).toThrow(/SESSION_HMAC_KEY/);
  });

  it('throws when SHARE_TOKEN_HMAC_KEY is shorter than 32 chars', () => {
    expect(() =>
      parseEnv({ ...BASE_ENV, SHARE_TOKEN_HMAC_KEY: 'too-short' }),
    ).toThrow(/SHARE_TOKEN_HMAC_KEY/);
  });

  it('accepts 32-char SESSION_HMAC_KEY and SHARE_TOKEN_HMAC_KEY', () => {
    const parsed = parseEnv({
      ...BASE_ENV,
      SESSION_HMAC_KEY: 'a'.repeat(32),
      SHARE_TOKEN_HMAC_KEY: 'b'.repeat(32),
    });
    expect(parsed.SESSION_HMAC_KEY).toBe('a'.repeat(32));
    expect(parsed.SHARE_TOKEN_HMAC_KEY).toBe('b'.repeat(32));
  });
});
