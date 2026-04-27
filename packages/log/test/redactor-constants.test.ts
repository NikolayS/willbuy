/**
 * redactor-constants.test.ts — spec-pins for security-relevant constants in
 * redactor.ts. These control what DOES and DOES NOT appear in log lines, so
 * any silent change is a potential PII/secret leak.
 *
 * MAX_STRING_LEN=16384 (16 KiB): strings longer than this are replaced by a
 * size marker. Raising it risks logging LLM output or captured-page bytes that
 * exceeded a prior field-name check; lowering it truncates legitimate values.
 *
 * TOKEN_LIKE_RE: catches 32+ char base62/base64/hex credentials in any field.
 * Changing the floor (32) or the alphabet changes which API keys / share-tokens
 * get masked.
 *
 * JWT_RE: three base64url segments, each ≥ 4 chars. Matches JWTs passed in
 * wrong-field-named log args. Weakening it could log session cookies.
 *
 * BARE_URL_RE / BARE_EMAIL_RE: values that look entirely like a URL or email
 * are hashed regardless of field name. Regex anchoring (^ and $) is critical —
 * remove either and partial matches would mask substrings in prose.
 *
 * HTML_SHAPE_RE: heuristic for captured-page bytes leaked via generic field
 * names. Must match opening tags but not innocuous angle brackets like "<3".
 *
 * Field name constants (API_KEY_FIELD, EMAIL_FIELD, URL_FIELD_SUFFIX,
 * URL_FIELD_NAME, STRICT_DURATION_PREFIX): renaming these silently stops
 * the matching they guard.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/redactor.js';

const {
  MAX_STRING_LEN,
  TOKEN_LIKE_RE,
  JWT_RE,
  BARE_URL_RE,
  BARE_EMAIL_RE,
  HTML_SHAPE_RE,
  API_KEY_FIELD,
  EMAIL_FIELD,
  URL_FIELD_SUFFIX,
  URL_FIELD_NAME,
  STRICT_DURATION_PREFIX,
} = __test__;

describe('MAX_STRING_LEN spec-pin', () => {
  it('is 16 KiB (16 × 1024 = 16384)', () => {
    expect(MAX_STRING_LEN).toBe(16 * 1024);
    expect(MAX_STRING_LEN).toBe(16_384);
  });
});

describe('TOKEN_LIKE_RE spec-pin', () => {
  it('matches a 32-char base62 string (API key body)', () => {
    expect(TOKEN_LIKE_RE.test('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef')).toBe(true);
  });

  it('does not match a 31-char string (below floor)', () => {
    expect(TOKEN_LIKE_RE.test('ABCDEFGHIJKLMNOPQRSTUVWXYZabcde')).toBe(false);
  });

  it('matches a 64-char hex digest', () => {
    expect(TOKEN_LIKE_RE.test('a'.repeat(64))).toBe(true);
  });

  it('does not match a string with spaces (anchored)', () => {
    expect(TOKEN_LIKE_RE.test('ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 extra')).toBe(false);
  });
});

describe('JWT_RE spec-pin', () => {
  it('matches a three-segment base64url JWT shape', () => {
    expect(JWT_RE.test('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')).toBe(true);
  });

  it('does not match prose containing a dot (not anchored to a full JWT)', () => {
    expect(JWT_RE.test('some prose.with a.dot in it')).toBe(false);
  });

  it('does not match a two-segment string', () => {
    expect(JWT_RE.test('eyJhbGc.eyJzdWI')).toBe(false);
  });
});

describe('BARE_URL_RE spec-pin', () => {
  it('matches an https URL', () => {
    expect(BARE_URL_RE.test('https://example.com/path?q=1')).toBe(true);
  });

  it('matches an http URL', () => {
    expect(BARE_URL_RE.test('http://internal.host/')).toBe(true);
  });

  it('does not match a URL with trailing whitespace (anchored)', () => {
    expect(BARE_URL_RE.test('https://example.com/ extra')).toBe(false);
  });

  it('does not match a bare domain without scheme', () => {
    expect(BARE_URL_RE.test('example.com')).toBe(false);
  });
});

describe('BARE_EMAIL_RE spec-pin', () => {
  it('matches a simple email address', () => {
    expect(BARE_EMAIL_RE.test('user@example.com')).toBe(true);
  });

  it('does not match a string with spaces', () => {
    expect(BARE_EMAIL_RE.test('hello user@example.com')).toBe(false);
  });

  it('does not match a string without @', () => {
    expect(BARE_EMAIL_RE.test('notanemail')).toBe(false);
  });
});

describe('HTML_SHAPE_RE spec-pin', () => {
  it('matches a standard HTML opening tag', () => {
    expect(HTML_SHAPE_RE.test('<div class="foo">')).toBe(true);
  });

  it('matches a doctype declaration', () => {
    expect(HTML_SHAPE_RE.test('<!DOCTYPE html>')).toBe(true);
  });

  it('does not match an innocuous angle bracket expression like "<3"', () => {
    expect(HTML_SHAPE_RE.test('<3')).toBe(false);
  });
});

describe('Field name constants spec-pin', () => {
  it('API_KEY_FIELD is "api_key"', () => {
    expect(API_KEY_FIELD).toBe('api_key');
  });

  it('EMAIL_FIELD is "email"', () => {
    expect(EMAIL_FIELD).toBe('email');
  });

  it('URL_FIELD_SUFFIX is "_url"', () => {
    expect(URL_FIELD_SUFFIX).toBe('_url');
  });

  it('URL_FIELD_NAME is "url"', () => {
    expect(URL_FIELD_NAME).toBe('url');
  });

  it('STRICT_DURATION_PREFIX is "duration_"', () => {
    expect(STRICT_DURATION_PREFIX).toBe('duration_');
  });
});
