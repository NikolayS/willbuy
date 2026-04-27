/**
 * masks.test.ts — direct unit tests for maskApiKey and maskEmail (spec §5.12).
 *
 * These pure helpers are exported from @willbuy/log but currently only tested
 * indirectly via the integration-level redact() assertions. Direct tests lock
 * in the exact output format so callers can depend on it.
 *
 * No I/O, no mocking — pure function calls.
 */

import { describe, expect, it } from 'vitest';
import { maskApiKey, maskEmail } from '../src/index.js';

// ── maskApiKey ────────────────────────────────────────────────────────────────

describe('maskApiKey()', () => {
  it('returns *** + last 4 chars for a typical API key', () => {
    expect(maskApiKey('sk_live_abcdefgh')).toBe('***efgh');
  });

  it('returns *** + last 4 chars for a 4-char key (entire key exposed as trailing 4)', () => {
    expect(maskApiKey('abcd')).toBe('***abcd');
  });

  it('handles a key shorter than 4 chars — slice(-4) returns whole string', () => {
    // 'xy' → last 4 is 'xy'; result is '***xy'
    expect(maskApiKey('xy')).toBe('***xy');
  });

  it('empty string → ***', () => {
    expect(maskApiKey('')).toBe('***');
  });

  it('long key — only last 4 chars visible', () => {
    const key = 'a'.repeat(64) + 'ZZZZ';
    expect(maskApiKey(key)).toBe('***ZZZZ');
  });

  it('format is always *** prefix (three stars, no variable-length asterisks)', () => {
    const result = maskApiKey('sk_live_testkey1234');
    expect(result.startsWith('***')).toBe(true);
    expect(result).toBe('***1234');
  });
});

// ── maskEmail ─────────────────────────────────────────────────────────────────

describe('maskEmail()', () => {
  it('typical email: nik@postgres.ai → n***@p***.ai', () => {
    expect(maskEmail('nik@postgres.ai')).toBe('n***@p***.ai');
  });

  it('single-char local-part: a@b.com → a***@b***.com', () => {
    expect(maskEmail('a@b.com')).toBe('a***@b***.com');
  });

  it('preserves TLD including multi-component: user@example.co.uk → u***@e***.uk', () => {
    // lastDot finds '.uk'; head is 'example.co'
    expect(maskEmail('user@example.co.uk')).toBe('u***@e***.uk');
  });

  it('domain with no dot → local masked + @ + first domain char + ***', () => {
    // 'nik@localhost' — domain 'localhost' has no dot
    expect(maskEmail('nik@localhost')).toBe('n***@l***');
  });

  it('string without @ returns ***', () => {
    expect(maskEmail('notanemail')).toBe('***');
  });

  it('@ at position 0 (empty local) returns ***', () => {
    expect(maskEmail('@example.com')).toBe('***');
  });

  it('@ at last position (empty domain) returns ***', () => {
    expect(maskEmail('nik@')).toBe('***');
  });

  it('numeric local part uses first digit as preserved char', () => {
    expect(maskEmail('1234@example.com')).toBe('1***@e***.com');
  });

  it('long local-part: only first char preserved', () => {
    const result = maskEmail('verylonglocalpart@short.io');
    expect(result.startsWith('v***@')).toBe(true);
    expect(result).toBe('v***@s***.io');
  });

  it('output never contains the original email string', () => {
    const email = 'private@company.com';
    const masked = maskEmail(email);
    expect(masked).not.toContain(email);
    expect(masked).not.toContain('rivate');
    expect(masked).not.toContain('ompany');
  });
});
