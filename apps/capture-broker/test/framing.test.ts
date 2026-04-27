/**
 * framing.test.ts — spec-pins for the capture-broker wire protocol (spec §5.13).
 *
 * Wire format: <u32be length><payload bytes>. The 4-byte big-endian header is
 * the entire framing contract. Changing HEADER_BYTES from 4 to 2 would break
 * every capture-worker and visitor-worker client; READ_TIMEOUT_MS=30_000
 * (N1) sets how long a stalled connection is tolerated before being killed.
 */

import { describe, expect, it } from 'vitest';

import { HEADER_BYTES, READ_TIMEOUT_MS, frame } from '../src/framing.js';

describe('HEADER_BYTES spec-pin (spec §5.13 — u32be length prefix)', () => {
  it('HEADER_BYTES is 4 (u32be = 4 bytes)', () => {
    expect(HEADER_BYTES).toBe(4);
  });

  it('frame() prepends exactly 4 header bytes to the payload', () => {
    const payload = Buffer.from('hello', 'utf8');
    const framed = frame(payload);
    expect(framed.length).toBe(payload.length + 4);
  });

  it('frame() header encodes payload length as big-endian u32', () => {
    const payload = Buffer.alloc(256, 0xff);
    const framed = frame(payload);
    const len = framed.readUInt32BE(0);
    expect(len).toBe(256);
  });

  it('frame() of empty payload has a 4-byte header encoding 0', () => {
    const framed = frame(Buffer.alloc(0));
    expect(framed.length).toBe(4);
    expect(framed.readUInt32BE(0)).toBe(0);
  });
});

describe('READ_TIMEOUT_MS spec-pin (spec §5.13 N1 — stall guard)', () => {
  it('READ_TIMEOUT_MS is 30_000 (30 seconds)', () => {
    expect(READ_TIMEOUT_MS).toBe(30_000);
  });
});
