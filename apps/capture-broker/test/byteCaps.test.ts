/**
 * byteCaps.test.ts — spec-pin tests for BYTE_CAPS constants (spec §5.13).
 *
 * The broker rejects payloads that exceed these caps AFTER schema parse,
 * BEFORE redaction + persistence. Pinning the values here catches a silent
 * change that would silently loosen the defense-in-depth layer.
 *
 * Tests:
 *   1. MESSAGE_BYTES is 32 MB (outer envelope + payload hard limit)
 *   2. A11Y_TREE_BYTES is 10 MB (matches capture-worker CAPTURE_CEILINGS)
 *   3. SCREENSHOT_BYTES is 5 MB (conservative v0.1 cap per spec §5.13 + §5.17)
 *   4. decodedBase64Bytes works for a known 3-byte encoding (sanity check)
 */

import { describe, expect, it } from 'vitest';
import { BYTE_CAPS, decodedBase64Bytes } from '../src/byteCaps.js';

describe('BYTE_CAPS spec-pin (spec §5.13)', () => {
  it('MESSAGE_BYTES is 32 MB', () => {
    expect(BYTE_CAPS.MESSAGE_BYTES).toBe(32 * 1024 * 1024);
  });

  it('A11Y_TREE_BYTES is 10 MB', () => {
    expect(BYTE_CAPS.A11Y_TREE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('SCREENSHOT_BYTES is 5 MB', () => {
    expect(BYTE_CAPS.SCREENSHOT_BYTES).toBe(5 * 1024 * 1024);
  });

  it('exactly 3 cap keys are defined', () => {
    expect(Object.keys(BYTE_CAPS)).toHaveLength(3);
  });
});

describe('decodedBase64Bytes sanity (spec §5.13)', () => {
  it('"AAAA" (4-char no-pad) → 3 decoded bytes', () => {
    expect(decodedBase64Bytes('AAAA')).toBe(3);
  });

  it('empty string → 0', () => {
    expect(decodedBase64Bytes('')).toBe(0);
  });

  it('non-base64 input → null', () => {
    expect(decodedBase64Bytes('!@#$')).toBeNull();
  });
});
