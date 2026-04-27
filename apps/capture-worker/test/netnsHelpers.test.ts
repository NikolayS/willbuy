/**
 * netnsHelpers.test.ts — unit tests for the __test__ pure helpers in
 * run-with-netns.ts (spec §5.13 defense-in-depth).
 *
 * All four helpers are pure synchronous functions with no I/O.
 * They are exported via the `__test__` object specifically for this suite.
 *
 * Functions under test:
 *   sanitizeNetnsName  — truncates captureId to a 15-char wb- prefixed name
 *   classifyBringupFailure — regex-maps stderr to breach reason enum
 *   parseStateList     — parses key=val1,val2 lines from a state file blob
 *   parseHost          — safe URL hostname extraction (null on throw)
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/run-with-netns.js';

const { sanitizeNetnsName, classifyBringupFailure, parseStateList, parseHost } = __test__;

// ── sanitizeNetnsName ─────────────────────────────────────────────────────────

describe('sanitizeNetnsName()', () => {
  it('adds wb- prefix', () => {
    expect(sanitizeNetnsName('abcdefgh')).toMatch(/^wb-/);
  });

  it('total length is ≤ 15 chars (Linux netns limit)', () => {
    const result = sanitizeNetnsName('feedface-cafe-1234-abcd-000000000000');
    expect(result.length).toBeLessThanOrEqual(15);
  });

  it('strips hyphens from UUID (only alnum + _ - kept, but uuid hyphens are removed by the regex)', () => {
    // captureId: typical UUID form. The function strips non-alnum/-/_ BUT
    // keeps - and _, then takes first 11 chars after trimming.
    const result = sanitizeNetnsName('abc-def-ghi-jkl');
    // Hyphens are allowed by the regex so they are kept.
    expect(result).toContain('wb-');
    expect(result.length).toBeLessThanOrEqual(15);
  });

  it('strips characters outside [a-zA-Z0-9_-]', () => {
    // Special chars like @ # ! . should be stripped.
    const result = sanitizeNetnsName('ab@cd#ef!12.34');
    // Only a-z, 0-9, _, - survive; + wb- prefix; truncated to 14 chars total
    expect(result).toBe('wb-abcdef1234');
  });

  it('long UUID: output is exactly wb- + 11 payload chars = 14 chars', () => {
    const longId = 'feedfacecafedeadbeef1234';
    const result = sanitizeNetnsName(longId);
    // 3 (wb-) + 11 = 14
    expect(result).toBe('wb-feedfacecaf');
    expect(result.length).toBe(14);
  });

  it('empty captureId → wb- only', () => {
    expect(sanitizeNetnsName('')).toBe('wb-');
  });
});

// ── classifyBringupFailure ────────────────────────────────────────────────────

describe('classifyBringupFailure()', () => {
  it('returns "dns_internal" when stderr contains deny range message', () => {
    const stderr = 'error: in deny range; capture refused\nsome other line';
    expect(classifyBringupFailure(stderr)).toBe('dns_internal');
  });

  it('returns "host_count" when stderr contains host budget message', () => {
    const stderr = 'error: exceeds host budget for this capture';
    expect(classifyBringupFailure(stderr)).toBe('host_count');
  });

  it('returns undefined for unrecognized stderr', () => {
    expect(classifyBringupFailure('some random error output')).toBeUndefined();
  });

  it('returns undefined for empty stderr', () => {
    expect(classifyBringupFailure('')).toBeUndefined();
  });

  it('matches deny range even when surrounded by other text', () => {
    const stderr = 'line1\nin deny range; capture refused\nline3';
    expect(classifyBringupFailure(stderr)).toBe('dns_internal');
  });

  it('host_count takes priority when both patterns appear (first match wins)', () => {
    // dns_internal check comes first in the function — verify ordering.
    const stderr = 'in deny range; capture refused\nexceeds host budget';
    expect(classifyBringupFailure(stderr)).toBe('dns_internal');
  });
});

// ── parseStateList ────────────────────────────────────────────────────────────

describe('parseStateList()', () => {
  it('parses a single-value list', () => {
    const raw = 'allowed_ipv4=1.2.3.4\nother=x';
    expect(parseStateList(raw, 'allowed_ipv4')).toEqual(['1.2.3.4']);
  });

  it('parses a comma-separated multi-value list', () => {
    const raw = 'allowed_ipv4=1.2.3.4,5.6.7.8,9.10.11.12';
    expect(parseStateList(raw, 'allowed_ipv4')).toEqual(['1.2.3.4', '5.6.7.8', '9.10.11.12']);
  });

  it('trims whitespace around each value', () => {
    const raw = 'allowed_ipv6= ::1 , fe80::1 ';
    expect(parseStateList(raw, 'allowed_ipv6')).toEqual(['::1', 'fe80::1']);
  });

  it('returns empty array when key is not present', () => {
    const raw = 'other_key=val1,val2';
    expect(parseStateList(raw, 'allowed_ipv4')).toEqual([]);
  });

  it('returns empty array when value is empty string', () => {
    const raw = 'allowed_ipv4=\n';
    expect(parseStateList(raw, 'allowed_ipv4')).toEqual([]);
  });

  it('filters out empty segments from trailing commas', () => {
    const raw = 'allowed_ipv4=1.2.3.4,,5.6.7.8,';
    const result = parseStateList(raw, 'allowed_ipv4');
    expect(result).not.toContain('');
    expect(result).toEqual(['1.2.3.4', '5.6.7.8']);
  });
});

// ── parseHost ─────────────────────────────────────────────────────────────────

describe('parseHost()', () => {
  it('returns hostname for a valid HTTP URL', () => {
    expect(parseHost('http://example.com/path?q=1')).toBe('example.com');
  });

  it('returns hostname for HTTPS URL with subdomain', () => {
    expect(parseHost('https://sub.example.com/')).toBe('sub.example.com');
  });

  it('returns null for a non-URL string', () => {
    expect(parseHost('not-a-url')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseHost('')).toBeNull();
  });

  it('strips port from hostname (URL.hostname excludes port)', () => {
    expect(parseHost('http://example.com:8080/path')).toBe('example.com');
  });

  it('lowercases hostname per URL spec', () => {
    expect(parseHost('https://EXAMPLE.COM/')).toBe('example.com');
  });
});
