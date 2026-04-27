/**
 * brokerClientDefaults.test.ts — spec-pins for broker-client.ts defaults.
 *
 * Spec §5.13: the capture-worker connects to the broker Unix socket at a
 * well-known path. Changing DEFAULT_SOCKET_PATH without updating the broker
 * systemd unit and deploy scripts would silently break all production captures.
 *
 * DEFAULT_TIMEOUT_MS must match (or exceed) the broker's READ_TIMEOUT_MS=30_000
 * so the client doesn't give up while the broker is still reading.
 *
 * HEADER_BYTES=4 mirrors apps/capture-broker/src/framing.ts — the two must
 * stay in sync; they are intentionally duplicated (no cross-package dep).
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/broker-client.js';

const { DEFAULT_SOCKET_PATH, DEFAULT_TIMEOUT_MS, HEADER_BYTES } = __test__;

describe('broker-client default constants (spec §5.13)', () => {
  it('DEFAULT_SOCKET_PATH is "/run/willbuy/broker.sock"', () => {
    expect(DEFAULT_SOCKET_PATH).toBe('/run/willbuy/broker.sock');
  });

  it('DEFAULT_TIMEOUT_MS is 30_000 (matches broker READ_TIMEOUT_MS)', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it('HEADER_BYTES is 4 (mirrors capture-broker framing.ts)', () => {
    expect(HEADER_BYTES).toBe(4);
  });
});
