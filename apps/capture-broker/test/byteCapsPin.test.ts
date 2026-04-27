/**
 * byteCapsPin.test.ts — spec-pin for BYTE_CAPS values (spec §5.13, §2 #6).
 *
 * The existing server.test.ts uses BYTE_CAPS.A11Y_TREE_BYTES as a runtime
 * value for an integration test but never pins its numeric value. This file
 * pins all three caps so a silent spec deviation is caught without the
 * full Unix-socket integration suite.
 *
 * Spec refs:
 *   §5.13 — broker byte caps: a11y_tree ≤ 10 MB, screenshot ≤ 5 MB.
 *   §2 #6 — defense-in-depth: message envelope ≤ 32 MB.
 */

import { describe, it, expect } from 'vitest';
import { BYTE_CAPS } from '../src/byteCaps.js';

describe('BYTE_CAPS spec-pin (spec §5.13, §2 #6)', () => {
  it('MESSAGE_BYTES is 32 MB', () => {
    expect(BYTE_CAPS.MESSAGE_BYTES).toBe(32 * 1024 * 1024);
  });

  it('A11Y_TREE_BYTES is 10 MB (spec §5.13)', () => {
    expect(BYTE_CAPS.A11Y_TREE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('SCREENSHOT_BYTES is 5 MB (spec §5.13)', () => {
    expect(BYTE_CAPS.SCREENSHOT_BYTES).toBe(5 * 1024 * 1024);
  });

  it('has exactly 3 cap keys', () => {
    expect(Object.keys(BYTE_CAPS)).toHaveLength(3);
  });

  it('MESSAGE_BYTES >= A11Y_TREE_BYTES >= SCREENSHOT_BYTES (structural ordering)', () => {
    expect(BYTE_CAPS.MESSAGE_BYTES).toBeGreaterThanOrEqual(BYTE_CAPS.A11Y_TREE_BYTES);
    expect(BYTE_CAPS.A11Y_TREE_BYTES).toBeGreaterThanOrEqual(BYTE_CAPS.SCREENSHOT_BYTES);
  });

  it('all cap values are positive integers', () => {
    for (const [key, value] of Object.entries(BYTE_CAPS)) {
      expect(Number.isInteger(value), `${key}: not an integer`).toBe(true);
      expect(value > 0, `${key}: not positive`).toBe(true);
    }
  });
});
