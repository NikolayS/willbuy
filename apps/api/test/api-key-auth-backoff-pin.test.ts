/**
 * api-key-auth-backoff-pin.test.ts — spec-pins for API key format constants,
 * auth session constants, and backstory-lease backoff constants.
 *
 * API key format (api-keys.ts):
 *   PREFIX='sk_live_' + KEY_BODY_LEN=24 base62 chars → 32-char total key.
 *   Changing PREFIX silently invalidates existing keys stored in user agents
 *   (the display prefix shown in the dashboard would also drift).
 *   KEY_BODY_LEN controls the entropy of every generated key — lowering it
 *   is a security regression. BASE62 length must be 62 (full alphabet).
 *
 * Auth constants (auth.ts):
 *   SESSION_7_DAYS_SECONDS = 604800 — the cookie Max-Age; shortening it logs
 *   users out unexpectedly. MAGIC_LINK_EXPIRY_MINUTES = 30 — the window a
 *   user has to click a magic link; shortening it silently breaks slow mail.
 *
 * Backoff constants (backstory-lease.ts):
 *   BACKOFF_BASE_MS=100, BACKOFF_FACTOR=4, BACKOFF_MAX_TRIES=3 — jittered
 *   exponential backoff: 100 ms → 400 ms → 1.6 s (with ±20% jitter).
 *   Changing BACKOFF_MAX_TRIES=1 would silently drop retry protection.
 */

import { describe, expect, it } from 'vitest';
import { __test__ as apiKeysTest } from '../src/routes/api-keys.js';
import { __test__ as authTest } from '../src/routes/auth.js';
import { __test__ as leaseTest } from '../src/leases/backstory-lease.js';

const { BASE62, PREFIX, KEY_BODY_LEN, PREFIX_DISPLAY_LEN } = apiKeysTest;
const { SESSION_7_DAYS_SECONDS, MAGIC_LINK_EXPIRY_MINUTES } = authTest;
const { BACKOFF_BASE_MS, BACKOFF_FACTOR, BACKOFF_MAX_TRIES } = leaseTest;

describe('API key format spec-pin (api-keys.ts)', () => {
  it('PREFIX is "sk_live_"', () => {
    expect(PREFIX).toBe('sk_live_');
  });

  it('KEY_BODY_LEN is 24 (24 chars entropy after prefix)', () => {
    expect(KEY_BODY_LEN).toBe(24);
  });

  it('PREFIX_DISPLAY_LEN is PREFIX.length + 1 = 9', () => {
    expect(PREFIX_DISPLAY_LEN).toBe(PREFIX.length + 1);
    expect(PREFIX_DISPLAY_LEN).toBe(9);
  });

  it('BASE62 has exactly 62 characters', () => {
    expect(BASE62).toHaveLength(62);
  });

  it('BASE62 contains only alphanumeric characters', () => {
    expect(BASE62).toMatch(/^[A-Za-z0-9]{62}$/);
  });

  it('total key length is PREFIX.length + KEY_BODY_LEN = 32', () => {
    expect(PREFIX.length + KEY_BODY_LEN).toBe(32);
  });
});

describe('Auth session constants spec-pin (auth.ts)', () => {
  it('SESSION_7_DAYS_SECONDS is exactly 604800 (7 × 24 × 60 × 60)', () => {
    expect(SESSION_7_DAYS_SECONDS).toBe(604_800);
    expect(SESSION_7_DAYS_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('MAGIC_LINK_EXPIRY_MINUTES is 30', () => {
    expect(MAGIC_LINK_EXPIRY_MINUTES).toBe(30);
  });
});

describe('Backstory-lease backoff constants spec-pin (backstory-lease.ts)', () => {
  it('BACKOFF_BASE_MS is 100 ms', () => {
    expect(BACKOFF_BASE_MS).toBe(100);
  });

  it('BACKOFF_FACTOR is 4 (100→400→1600 ms schedule)', () => {
    expect(BACKOFF_FACTOR).toBe(4);
  });

  it('BACKOFF_MAX_TRIES is 3', () => {
    expect(BACKOFF_MAX_TRIES).toBe(3);
  });

  it('third backoff ceiling (base × factor²) is 1600 ms', () => {
    expect(BACKOFF_BASE_MS * BACKOFF_FACTOR ** 2).toBe(1_600);
  });
});
