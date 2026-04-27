/**
 * api-key-constraints-pin.test.ts — spec-pins for API key format constants
 * and label field constraints in apps/api/src/routes/api-keys.ts.
 *
 * API key format (no Docker needed):
 *   PREFIX='sk_live_', KEY_BODY_LEN=24, BASE62 length=62.
 *   Changing PREFIX invalidates existing stored keys.
 *   Lowering KEY_BODY_LEN reduces entropy — security regression.
 *
 * Label field constraints (CreateKeyBodySchema):
 *   min=1 (empty label rejected), max=80 (long label rejected).
 *   Changing max=80 silently allows longer labels in the DB column
 *   which has a TEXT type but is displayed in a fixed-width UI column.
 *   These constraints are only tested inside the Docker-gated
 *   describeIfDocker block in api-keys.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/routes/api-keys.js';

const { BASE62, PREFIX, KEY_BODY_LEN, PREFIX_DISPLAY_LEN, CreateKeyBodySchema } = __test__;

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

  it('total key length = PREFIX.length + KEY_BODY_LEN = 32', () => {
    expect(PREFIX.length + KEY_BODY_LEN).toBe(32);
  });
});

describe('CreateKeyBodySchema label constraints spec-pin', () => {
  it('accepts a label of exactly 1 char (minimum)', () => {
    expect(() => CreateKeyBodySchema.parse({ label: 'A' })).not.toThrow();
  });

  it('accepts a label of exactly 80 chars (maximum)', () => {
    expect(() => CreateKeyBodySchema.parse({ label: 'a'.repeat(80) })).not.toThrow();
  });

  it('rejects an empty label (min=1)', () => {
    expect(() => CreateKeyBodySchema.parse({ label: '' })).toThrow(/label is required/);
  });

  it('rejects a label of 81 chars (max=80)', () => {
    expect(() => CreateKeyBodySchema.parse({ label: 'a'.repeat(81) })).toThrow(/label is too long/);
  });

  it('trims whitespace before validation (trim() before min check)', () => {
    // A label that is only spaces should fail min=1 after trimming.
    expect(() => CreateKeyBodySchema.parse({ label: '   ' })).toThrow();
  });
});
