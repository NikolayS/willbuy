/**
 * brokerErrorCodesPin.test.ts — spec-pin for BrokerErrorCode values
 * in apps/capture-broker/src/schema.ts (spec §5.13).
 *
 * BrokerErrorCode is the TypeScript union type for broker rejection
 * reasons returned to the capture-worker over the Unix socket:
 *
 *   'malformed_json' | 'schema_invalid' | 'a11y_tree_too_big' |
 *   'screenshot_too_big' | 'message_too_big' | 'duplicate_message' |
 *   'storage_failed' | 'db_failed' | 'internal'
 *
 * The values that the existing server.test.ts exercises (via real socket
 * interactions): malformed_json, schema_invalid, a11y_tree_too_big,
 * duplicate_message. The remaining four ('screenshot_too_big',
 * 'message_too_big', 'storage_failed', 'db_failed', 'internal') are
 * emitted in server.ts but not independently tested.
 *
 * Risk: these strings appear in capture-worker structured logs as
 * `error_class`. If any rename (e.g. 'storage_failed' → 'store_failed'),
 * alerting rules watching error_class would silently stop firing.
 *
 * TypeScript protects compile-time correctness within the repo, but a
 * rebranding of the string values is a valid change that TypeScript allows
 * (all uses update together) — we want to flag this as a spec-breaking
 * change. Pin strategy: read schema.ts source as text.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSrc = resolve(here, '..', 'src', 'schema.ts');

const src = readFileSync(schemaSrc, 'utf8');

const EXPECTED_ERROR_CODES = [
  'malformed_json',
  'schema_invalid',
  'a11y_tree_too_big',
  'screenshot_too_big',
  'message_too_big',
  'duplicate_message',
  'storage_failed',
  'db_failed',
  'internal',
] as const;

describe('BrokerErrorCode spec-pin (spec §5.13 — capture-worker wire format)', () => {
  it('schema.ts source exists', () => {
    expect(() => readFileSync(schemaSrc, 'utf8')).not.toThrow();
  });

  for (const code of EXPECTED_ERROR_CODES) {
    it(`BrokerErrorCode union includes '${code}'`, () => {
      expect(src).toContain(`'${code}'`);
    });
  }

  it('BrokerErrorCode has exactly 9 members', () => {
    // Count occurrences of each expected code inside the BrokerErrorCode
    // type block. We assert all 9 are present and that no unexpected codes
    // were added without this test being updated.
    const typeBlock = src.slice(
      src.indexOf('BrokerErrorCode ='),
      src.indexOf(';', src.indexOf('BrokerErrorCode =')),
    );
    const matches = typeBlock.match(/'\w+'/g) ?? [];
    expect(matches).toHaveLength(EXPECTED_ERROR_CODES.length);
  });
});
