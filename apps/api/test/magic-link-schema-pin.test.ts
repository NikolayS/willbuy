/**
 * magic-link-schema-pin.test.ts — spec-pin for MagicLinkBody schema
 * boundaries (spec §2 #26, §4.1). No DB required.
 *
 * The existing auth.test.ts tests the full magic-link flow (Docker-gated).
 * This file pins the Zod schema contract standalone.
 */

import { describe, it, expect } from 'vitest';
import { __test__ } from '../src/routes/auth.js';

const { MagicLinkBody, SESSION_7_DAYS_SECONDS, MAGIC_LINK_EXPIRY_MINUTES } = __test__;

describe('MagicLinkBody — email field validation (spec §2 #26)', () => {
  it('accepts a valid email', () => {
    expect(MagicLinkBody.safeParse({ email: 'user@example.com' }).success).toBe(true);
  });

  it('rejects a string without @ (not an email)', () => {
    expect(MagicLinkBody.safeParse({ email: 'notanemail' }).success).toBe(false);
  });

  it('rejects an empty email string', () => {
    expect(MagicLinkBody.safeParse({ email: '' }).success).toBe(false);
  });

  it('rejects missing email field', () => {
    expect(MagicLinkBody.safeParse({}).success).toBe(false);
  });
});

describe('MagicLinkBody — redirect field (optional, max=200)', () => {
  it('accepts a valid relative path as redirect', () => {
    const r = MagicLinkBody.safeParse({ email: 'a@b.com', redirect: '/dashboard' });
    expect(r.success).toBe(true);
  });

  it('accepts missing redirect (optional)', () => {
    const r = MagicLinkBody.safeParse({ email: 'a@b.com' });
    expect(r.success).toBe(true);
  });

  it('accepts redirect of exactly 200 chars', () => {
    const r = MagicLinkBody.safeParse({ email: 'a@b.com', redirect: '/'.repeat(200) });
    expect(r.success).toBe(true);
  });

  it('rejects redirect of 201 chars', () => {
    const r = MagicLinkBody.safeParse({ email: 'a@b.com', redirect: '/'.repeat(201) });
    expect(r.success).toBe(false);
  });
});

describe('Auth constants (spec §5.10, §2 #21)', () => {
  it('SESSION_7_DAYS_SECONDS is 604800', () => {
    expect(SESSION_7_DAYS_SECONDS).toBe(604_800);
  });

  it('MAGIC_LINK_EXPIRY_MINUTES is 30', () => {
    expect(MAGIC_LINK_EXPIRY_MINUTES).toBe(30);
  });
});
