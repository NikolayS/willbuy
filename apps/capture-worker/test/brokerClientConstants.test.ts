/**
 * brokerClientConstants.test.ts — spec-pins for HEADER_BYTES, DEFAULT_SOCKET_PATH,
 * and DEFAULT_TIMEOUT_MS in apps/capture-worker/src/broker-client.ts.
 *
 * HEADER_BYTES=4: must match apps/capture-broker/src/framing.ts exactly.
 * A mismatch causes the broker to misparse the length prefix and corrupt
 * every message. The comment in broker-client.ts calls this out explicitly.
 *
 * DEFAULT_SOCKET_PATH='/run/willbuy/broker.sock': the Unix socket path
 * hardcoded in the systemd unit (ExecStart). Changing one without the other
 * silently breaks the capture-worker → broker IPC.
 *
 * DEFAULT_TIMEOUT_MS=30000: connection + read timeout for broker calls.
 * Lowering it causes spurious timeouts under load; raising it means a stuck
 * broker blocks the visit for longer before the worker times out.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/broker-client.js';

const { HEADER_BYTES, DEFAULT_SOCKET_PATH, DEFAULT_TIMEOUT_MS } = __test__;

describe('HEADER_BYTES spec-pin (broker-client.ts — must mirror framing.ts)', () => {
  it('is 4 (big-endian UInt32 length prefix)', () => {
    expect(HEADER_BYTES).toBe(4);
  });
});

describe('DEFAULT_SOCKET_PATH spec-pin (broker-client.ts)', () => {
  it('is "/run/willbuy/broker.sock"', () => {
    expect(DEFAULT_SOCKET_PATH).toBe('/run/willbuy/broker.sock');
  });
});

describe('DEFAULT_TIMEOUT_MS spec-pin (broker-client.ts)', () => {
  it('is 30000 ms (30 seconds)', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_TIMEOUT_MS).toBe(30 * 1000);
  });
});
