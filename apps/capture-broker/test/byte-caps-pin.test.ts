/**
 * byte-caps-pin.test.ts — spec-pins for BYTE_CAPS in capture-broker/byteCaps.ts.
 *
 * Spec §5.13 + §2 #6: byte caps are enforced AFTER schema parse, BEFORE
 * redaction and persistence. The broker rejects payloads that exceed these
 * limits without allocating the decoded buffer (it estimates decoded length
 * from base64 length using floor(len*3/4) - padding).
 *
 * MESSAGE_BYTES = 32 MiB: the maximum single Unix-socket message envelope.
 * Raising it allows larger attack payloads through; lowering it would reject
 * legitimate large a11y trees before the field-level cap fires.
 *
 * A11Y_TREE_BYTES = 10 MiB: decoded a11y-tree cap per spec §5.13.
 * The existing server.test.ts uses A11Y_TREE_BYTES + 1024 as a test value —
 * the literal 10 MiB was never directly asserted.
 *
 * SCREENSHOT_BYTES = 5 MiB: decoded screenshot cap. Raising it increases
 * storage costs and S3 PUT latency for every successful capture.
 *
 * Cross-checks: A11Y cap ≤ MESSAGE cap, SCREENSHOT cap ≤ MESSAGE cap,
 * and SCREENSHOT ≤ A11Y (screenshots are typically smaller than trees).
 */

import { describe, expect, it } from 'vitest';
import { BYTE_CAPS } from '../src/byteCaps.js';

describe('BYTE_CAPS spec-pin (byteCaps.ts — spec §5.13 + §2 #6)', () => {
  it('MESSAGE_BYTES is 32 MiB (32 × 1024 × 1024)', () => {
    expect(BYTE_CAPS.MESSAGE_BYTES).toBe(32 * 1024 * 1024);
    expect(BYTE_CAPS.MESSAGE_BYTES).toBe(33_554_432);
  });

  it('A11Y_TREE_BYTES is 10 MiB (10 × 1024 × 1024)', () => {
    expect(BYTE_CAPS.A11Y_TREE_BYTES).toBe(10 * 1024 * 1024);
    expect(BYTE_CAPS.A11Y_TREE_BYTES).toBe(10_485_760);
  });

  it('SCREENSHOT_BYTES is 5 MiB (5 × 1024 × 1024)', () => {
    expect(BYTE_CAPS.SCREENSHOT_BYTES).toBe(5 * 1024 * 1024);
    expect(BYTE_CAPS.SCREENSHOT_BYTES).toBe(5_242_880);
  });

  it('A11Y_TREE_BYTES ≤ MESSAGE_BYTES (field cap must not exceed envelope cap)', () => {
    expect(BYTE_CAPS.A11Y_TREE_BYTES).toBeLessThanOrEqual(BYTE_CAPS.MESSAGE_BYTES);
  });

  it('SCREENSHOT_BYTES ≤ MESSAGE_BYTES', () => {
    expect(BYTE_CAPS.SCREENSHOT_BYTES).toBeLessThanOrEqual(BYTE_CAPS.MESSAGE_BYTES);
  });

  it('SCREENSHOT_BYTES ≤ A11Y_TREE_BYTES (screenshots are smaller than trees)', () => {
    expect(BYTE_CAPS.SCREENSHOT_BYTES).toBeLessThanOrEqual(BYTE_CAPS.A11Y_TREE_BYTES);
  });
});
