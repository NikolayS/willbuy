/**
 * allowlist-remove-fields-pin.test.ts — spec-pins for STRICT_ALLOWLIST
 * and REMOVE_FIELDS in packages/log/src/redactor.ts (spec §5.12).
 *
 * STRICT_ALLOWLIST (11 entries):
 *   When the logger is built with `strict: true`, ONLY fields in this set
 *   (or matching the `duration_` prefix) are emitted. Adding a field to this
 *   set could silently expose sensitive data; removing one could silently drop
 *   required observability fields (e.g. removing 'account_id' breaks log
 *   grouping by account). Pins all 11 allowlisted fields and the total count.
 *
 * REMOVE_FIELDS (8 entries):
 *   Fields whose values are ALWAYS stripped — regardless of strict mode.
 *   Removing 'backstory' would expose LLM inputs in logs. Removing 'password'
 *   would expose passwords. Pins all 8 entries plus count.
 *
 * Negative: 'backstory' must be in REMOVE_FIELDS but NOT in STRICT_ALLOWLIST
 * (it's a removed field, not a permitted field). A copy-paste error could
 * accidentally add it to both.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/redactor.js';

const { STRICT_ALLOWLIST, REMOVE_FIELDS, STRICT_DURATION_PREFIX, API_KEY_FIELD } = __test__;

describe('STRICT_ALLOWLIST spec-pin (packages/log — spec §5.12)', () => {
  it('has exactly 11 entries', () => {
    expect(STRICT_ALLOWLIST.size).toBe(11);
  });

  const requiredFields = [
    'account_id',
    'study_id',
    'visit_id',
    'provider_attempt_id',
    'transport_attempt_id',
    'event',
    'error_class',
    'msg',
    'level',
    'time',
    'service',
  ];

  for (const field of requiredFields) {
    it(`contains "${field}"`, () => {
      expect(STRICT_ALLOWLIST.has(field)).toBe(true);
    });
  }
});

describe('REMOVE_FIELDS spec-pin (packages/log — spec §5.12)', () => {
  it('has exactly 8 entries', () => {
    expect(REMOVE_FIELDS.size).toBe(8);
  });

  const removedFields = [
    'share_token',
    'backstory',
    'a11y_tree',
    'llm_output',
    'provider_payload',
    'password',
    'page_bytes',
    'error_detail',
  ];

  for (const field of removedFields) {
    it(`contains "${field}"`, () => {
      expect(REMOVE_FIELDS.has(field)).toBe(true);
    });
  }
});

describe('STRICT_ALLOWLIST / REMOVE_FIELDS disjoint guard', () => {
  it('"backstory" is in REMOVE_FIELDS but NOT in STRICT_ALLOWLIST', () => {
    expect(REMOVE_FIELDS.has('backstory')).toBe(true);
    expect(STRICT_ALLOWLIST.has('backstory')).toBe(false);
  });

  it('"password" is in REMOVE_FIELDS but NOT in STRICT_ALLOWLIST', () => {
    expect(REMOVE_FIELDS.has('password')).toBe(true);
    expect(STRICT_ALLOWLIST.has('password')).toBe(false);
  });

  it('no field appears in both sets (fully disjoint)', () => {
    for (const field of REMOVE_FIELDS) {
      expect(STRICT_ALLOWLIST.has(field)).toBe(false);
    }
  });
});

describe('STRICT_DURATION_PREFIX spec-pin', () => {
  it('is "duration_"', () => {
    expect(STRICT_DURATION_PREFIX).toBe('duration_');
  });
});

describe('API_KEY_FIELD spec-pin', () => {
  it('is "api_key"', () => {
    expect(API_KEY_FIELD).toBe('api_key');
  });
});
