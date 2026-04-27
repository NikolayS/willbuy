/**
 * framingFunctions.test.ts — unit tests for the frame() wire-format function
 * (spec §5.13 — length-prefixed framing).
 *
 * The existing tests use frame() as a helper for the server integration suite
 * but never assert its wire-format correctness directly. These tests pin that
 * frame() emits a correct u32be length prefix followed by the payload bytes.
 *
 * Spec ref: §5.13 — `<u32be length><payload bytes>` wire format.
 */

import { describe, it, expect } from 'vitest';
import { frame, HEADER_BYTES } from '../src/framing.js';

describe('frame() — spec §5.13 u32be length-prefix format', () => {
  it('produces a buffer of length HEADER_BYTES + payload.length', () => {
    const payload = Buffer.from('hello');
    const framed = frame(payload);
    expect(framed.length).toBe(HEADER_BYTES + payload.length);
  });

  it('encodes payload length as a big-endian u32 in the first 4 bytes', () => {
    const payload = Buffer.from('hello world');
    const framed = frame(payload);
    const declaredLen = framed.readUInt32BE(0);
    expect(declaredLen).toBe(payload.length);
  });

  it('appends the payload bytes unchanged after the header', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03, 0xff]);
    const framed = frame(payload);
    const extractedPayload = framed.slice(HEADER_BYTES);
    expect(extractedPayload).toEqual(payload);
  });

  it('handles an empty payload (length=0)', () => {
    const payload = Buffer.alloc(0);
    const framed = frame(payload);
    expect(framed.length).toBe(HEADER_BYTES);
    expect(framed.readUInt32BE(0)).toBe(0);
  });

  it('correctly encodes a large payload length (> 0xFFFF)', () => {
    const payload = Buffer.alloc(100_000, 0x42);
    const framed = frame(payload);
    expect(framed.readUInt32BE(0)).toBe(100_000);
    expect(framed.length).toBe(HEADER_BYTES + 100_000);
  });
});
