/**
 * domain-schema-pin.test.ts — spec-pin for domain route schema bounds
 * and constants (no DB required).
 *
 * Spec refs:
 *   §2 #1  — Domain name max 253 chars (DNS FQDN limit).
 *   §2 #1  — Probe timeout 5 s, verification token 22 chars.
 */

import { describe, it, expect } from 'vitest';
import { __test__ } from '../src/routes/domains.js';

const { PROBE_TIMEOUT_MS, TOKEN_LENGTH, CreateDomainBody } = __test__;

describe('CreateDomainBody — domain string bounds (spec §2 #1)', () => {
  it('accepts a valid eTLD+1 domain string', () => {
    const r = CreateDomainBody.safeParse({ domain: 'example.com' });
    expect(r.success).toBe(true);
  });

  it('accepts a domain string of exactly 253 chars (DNS max)', () => {
    const d = 'x'.repeat(253);
    expect(d.length).toBe(253);
    const r = CreateDomainBody.safeParse({ domain: d });
    expect(r.success).toBe(true);
  });

  it('rejects a domain string of 254 chars', () => {
    const d = 'x'.repeat(254);
    expect(d.length).toBe(254);
    const r = CreateDomainBody.safeParse({ domain: d });
    expect(r.success).toBe(false);
  });

  it('rejects an empty string (min=1)', () => {
    const r = CreateDomainBody.safeParse({ domain: '' });
    expect(r.success).toBe(false);
  });

  it('rejects a missing domain field', () => {
    const r = CreateDomainBody.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('Domain probe constants (spec §2 #1)', () => {
  it('PROBE_TIMEOUT_MS is 5000 ms (5 s)', () => {
    expect(PROBE_TIMEOUT_MS).toBe(5_000);
  });

  it('TOKEN_LENGTH is 22', () => {
    expect(TOKEN_LENGTH).toBe(22);
  });
});
