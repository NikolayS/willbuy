/**
 * auth-domain-constants-pin.test.ts — spec-pin for auth and domain
 * route constants (no DB required).
 *
 * Spec refs:
 *   §5.10  — wb_session cookie lifetime: 7 days (SESSION_7_DAYS_SECONDS=604800).
 *   §2 #21 — Magic-link expiry: 30 minutes (MAGIC_LINK_EXPIRY_MINUTES=30).
 *   §2 #1  — Domain probe timeout: 5 s (PROBE_TIMEOUT_MS=5000).
 *   §2 #1  — Verification token length: 22 chars (TOKEN_LENGTH=22).
 */

import { describe, it, expect } from 'vitest';
import { __test__ as authTest } from '../src/routes/auth.js';
import { __test__ as domainsTest } from '../src/routes/domains.js';

const { SESSION_7_DAYS_SECONDS, MAGIC_LINK_EXPIRY_MINUTES } = authTest;
const { PROBE_TIMEOUT_MS, TOKEN_LENGTH } = domainsTest;

describe('Auth constants (spec §5.10, §2 #21)', () => {
  it('SESSION_7_DAYS_SECONDS is 604800 (7 × 24 × 60 × 60)', () => {
    expect(SESSION_7_DAYS_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(SESSION_7_DAYS_SECONDS).toBe(604_800);
  });

  it('MAGIC_LINK_EXPIRY_MINUTES is 30', () => {
    expect(MAGIC_LINK_EXPIRY_MINUTES).toBe(30);
  });
});

describe('Domain probe constants (spec §2 #1)', () => {
  it('PROBE_TIMEOUT_MS is 5000 ms (5 s)', () => {
    expect(PROBE_TIMEOUT_MS).toBe(5_000);
  });

  it('TOKEN_LENGTH is 22 chars', () => {
    expect(TOKEN_LENGTH).toBe(22);
  });
});
