/**
 * maskFormatPin.test.ts — spec-pin for maskApiKey() and maskEmail() output
 * format (spec §5.12 / issue #118).
 *
 * The existing redactor.test.ts verifies that logger output contains the
 * result of maskApiKey(tok) but never pins what that result actually looks
 * like as a string. This file directly asserts the output format so a change
 * to the masking format fails CI rather than silently appearing in logs.
 *
 * Spec refs:
 *   §2 #22 — API keys masked to last 4 chars in logs.
 *   §5.12  — PII field masking policy.
 */

import { describe, it, expect } from 'vitest';
import { maskApiKey, maskEmail } from '../src/redactor.js';

describe('maskApiKey() format (spec §2 #22)', () => {
  it('masks to ***<last4> for a standard sk_live_ key', () => {
    expect(maskApiKey('sk_live_abcd1234')).toBe('***1234');
  });

  it('always keeps exactly the last 4 chars of the key', () => {
    expect(maskApiKey('ABCDEFGH')).toBe('***EFGH');
    expect(maskApiKey('x')).toBe('***x');
  });

  it('prefix is exactly "***" (three asterisks)', () => {
    const result = maskApiKey('sk_live_test1234');
    expect(result.startsWith('***')).toBe(true);
    expect(result.slice(0, 3)).toBe('***');
  });

  it('total length is 7 for a 4-char key (prefix=3 + last4=4)', () => {
    const result = maskApiKey('sk_live_abcd1234');
    expect(result.length).toBe(3 + 4); // *** + last4
  });
});

describe('maskEmail() format (spec §5.12)', () => {
  it('masks nik@postgres.ai → n***@p***.ai', () => {
    expect(maskEmail('nik@postgres.ai')).toBe('n***@p***.ai');
  });

  it('preserves TLD and first char of domain and local', () => {
    expect(maskEmail('bogdan@example.com')).toBe('b***@e***.com');
  });

  it('returns *** for strings without @', () => {
    expect(maskEmail('notanemail')).toBe('***');
  });

  it('returns *** for string starting with @', () => {
    expect(maskEmail('@example.com')).toBe('***');
  });

  it('returns *** for string ending with @', () => {
    expect(maskEmail('user@')).toBe('***');
  });

  it('handles domain with no TLD dot: masks domain head only', () => {
    // No dot in domain → no TLD extraction
    expect(maskEmail('user@localhost')).toBe('u***@l***');
  });
});
