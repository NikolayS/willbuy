/**
 * framing-server-constants.test.ts — spec-pins for HEADER_BYTES (framing.ts),
 * READ_TIMEOUT_MS (framing.ts), and SOCKET_MODE (server.ts).
 *
 * HEADER_BYTES=4 (spec §5.13):
 *   Big-endian UInt32 length prefix. Both capture-broker (framing.ts) and
 *   capture-worker (broker-client.ts) must agree on this value — a mismatch
 *   corrupts every broker message. capture-worker explicitly notes it mirrors
 *   this constant.
 *
 * READ_TIMEOUT_MS=30000 (spec §5.13):
 *   Per-frame read timeout. If the worker holds a socket open without
 *   completing a frame, the broker closes it after this window to prevent
 *   resource leaks. Lowering it causes spurious disconnects under load.
 *
 * SOCKET_MODE=0o660 (spec §5.13):
 *   Unix socket inode permissions: rw-rw---- (owner + group, no world).
 *   If changed to 0o666 the socket becomes world-accessible, breaking the
 *   security boundary between the broker and other processes.
 */

import { describe, expect, it } from 'vitest';
import { HEADER_BYTES, READ_TIMEOUT_MS } from '../src/framing.js';
import { SOCKET_MODE } from '../src/server.js';

describe('HEADER_BYTES spec-pin (framing.ts — spec §5.13)', () => {
  it('is 4 (big-endian UInt32 length prefix)', () => {
    expect(HEADER_BYTES).toBe(4);
  });
});

describe('READ_TIMEOUT_MS spec-pin (framing.ts — spec §5.13)', () => {
  it('is 30000 ms (30 seconds)', () => {
    expect(READ_TIMEOUT_MS).toBe(30_000);
    expect(READ_TIMEOUT_MS).toBe(30 * 1000);
  });
});

describe('SOCKET_MODE spec-pin (server.ts — spec §5.13 rw-rw----)', () => {
  it('is 0o660 (owner + group RW, no world access)', () => {
    expect(SOCKET_MODE).toBe(0o660);
  });

  it('does not grant world-readable access (bit 0o004 unset)', () => {
    expect(SOCKET_MODE & 0o004).toBe(0);
  });

  it('does not grant world-writable access (bit 0o002 unset)', () => {
    expect(SOCKET_MODE & 0o002).toBe(0);
  });

  it('grants owner read+write (bits 0o600 set)', () => {
    expect(SOCKET_MODE & 0o600).toBe(0o600);
  });

  it('grants group read+write (bits 0o060 set)', () => {
    expect(SOCKET_MODE & 0o060).toBe(0o060);
  });
});
