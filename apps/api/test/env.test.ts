import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/env.js';

describe('env validation (spec §4.1, CLAUDE.md zod-at-boundaries)', () => {
  it('accepts a valid env with a 32-char salt', () => {
    const parsed = parseEnv({
      URL_HASH_SALT: 'a'.repeat(32),
    });
    expect(parsed.PORT).toBe(3000);
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.URL_HASH_SALT).toBe('a'.repeat(32));
  });

  it('throws when URL_HASH_SALT is missing', () => {
    expect(() => parseEnv({})).toThrow(/URL_HASH_SALT/);
  });

  it('throws when URL_HASH_SALT is shorter than 32 chars', () => {
    expect(() => parseEnv({ URL_HASH_SALT: 'short' })).toThrow(/URL_HASH_SALT/);
  });

  it('coerces PORT from string to number', () => {
    const parsed = parseEnv({ URL_HASH_SALT: 'x'.repeat(32), PORT: '4242' });
    expect(parsed.PORT).toBe(4242);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() =>
      parseEnv({ URL_HASH_SALT: 'x'.repeat(32), LOG_LEVEL: 'shouty' }),
    ).toThrow(/LOG_LEVEL/);
  });
});
