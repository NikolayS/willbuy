/**
 * decodedBase64Bytes.test.ts — unit tests for the decodedBase64Bytes helper
 * in byteCaps.ts (spec §5.13, §2 #6).
 *
 * The function estimates decoded byte length from a base64 string WITHOUT
 * allocating a Buffer. This is the spec-required defense that rejects
 * oversized payloads before decoding them.
 *
 * Contract under test:
 *   - Returns null when the string is not plausibly base64.
 *   - Tolerates embedded whitespace.
 *   - Returns 0 for an empty string.
 *   - Returns the correct byte count for known encodings.
 */

import { describe, it, expect } from 'vitest';
import { decodedBase64Bytes } from '../src/byteCaps.js';

describe('decodedBase64Bytes — structural contract', () => {
  it('returns 0 for an empty string', () => {
    expect(decodedBase64Bytes('')).toBe(0);
  });

  it('returns null when length is not a multiple of 4 (invalid base64)', () => {
    expect(decodedBase64Bytes('abc')).toBeNull(); // len=3
    expect(decodedBase64Bytes('abcde')).toBeNull(); // len=5
  });

  it('returns null when the string contains non-base64 characters', () => {
    expect(decodedBase64Bytes('abc!')).toBeNull();
    expect(decodedBase64Bytes('abc@')).toBeNull();
  });
});

describe('decodedBase64Bytes — known decoding sizes', () => {
  it('1-byte payload encodes to 4 chars with 2 padding chars → 1 decoded byte', () => {
    // Buffer.from([0xff]).toString('base64') === '/w=='
    expect(decodedBase64Bytes('/w==')).toBe(1);
  });

  it('2-byte payload encodes to 4 chars with 1 padding char → 2 decoded bytes', () => {
    // Buffer.from([0xff, 0xfe]).toString('base64') === '//4='
    expect(decodedBase64Bytes('//4=')).toBe(2);
  });

  it('3-byte payload encodes to 4 chars with no padding → 3 decoded bytes', () => {
    // Buffer.from([0xff, 0xfe, 0xfd]).toString('base64') === '//79'
    expect(decodedBase64Bytes('//79')).toBe(3);
  });

  it('12-byte payload encodes to 16 chars → 12 decoded bytes', () => {
    const b16 = Buffer.from('hello world!').toString('base64');
    expect(decodedBase64Bytes(b16)).toBe(12);
  });
});

describe('decodedBase64Bytes — whitespace tolerance', () => {
  it('strips spaces and still computes the correct byte count', () => {
    const plain = Buffer.from('hello world!').toString('base64');
    // Insert spaces inside the base64 string.
    const withSpaces = plain.slice(0, 8) + ' ' + plain.slice(8);
    expect(decodedBase64Bytes(withSpaces)).toBe(12);
  });

  it('strips newlines (MIME-style line breaks) and computes correctly', () => {
    const plain = Buffer.from('hello world!').toString('base64');
    const withNewline = plain.slice(0, 8) + '\n' + plain.slice(8);
    expect(decodedBase64Bytes(withNewline)).toBe(12);
  });

  it('strips tabs and still computes correctly', () => {
    const plain = Buffer.from('hello world!').toString('base64');
    const withTab = plain.slice(0, 4) + '\t' + plain.slice(4);
    expect(decodedBase64Bytes(withTab)).toBe(12);
  });

  it('whitespace-only string returns 0', () => {
    expect(decodedBase64Bytes('   \n\t  ')).toBe(0);
  });
});
