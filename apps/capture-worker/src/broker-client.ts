/**
 * broker-client.ts — Unix-socket client for the capture broker (spec §5.13).
 *
 * Writes one typed {@link CaptureRequest} message over the broker Unix domain
 * socket and reads back the {@link BrokerAck} response.
 *
 * Protocol: length-prefixed framing identical to the broker server side
 * (apps/capture-broker/src/framing.ts). Single shot per connection.
 *
 * This module intentionally duplicates the framing constants rather than
 * importing from capture-broker (separate package; we don't want a hard dep
 * on the broker's internals from the worker).
 */

import { connect } from 'node:net';

// ── framing ───────────────────────────────────────────────────────────────────
// Mirrors apps/capture-broker/src/framing.ts — 4-byte big-endian length prefix.

const HEADER_BYTES = 4;

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

// ── types (re-stated from apps/capture-broker/src/schema.ts) ─────────────────
// We re-declare the wire types here so capture-worker has no package-level
// dep on capture-broker. The broker's schema.ts is the source of truth;
// any drift here will be caught by the integration test.

export type CaptureRequestPayload = {
  status: 'ok' | 'blocked' | 'error';
  a11y_tree_b64: string;
  screenshot_b64?: string;
  banner_selectors_matched: string[];
  overlays_unknown_present: boolean;
  blocked_reason?: string;
  host_count: number;
  breach_reason?: string;
};

export type BrokerAck =
  | {
      ok: true;
      capture_id: string;
      a11y_object_key: string;
      screenshot_object_key?: string;
    }
  | {
      ok: false;
      error: string;
      detail?: string;
    };

export type BrokerClientOpts = {
  /** Path to the Unix domain socket (default: /run/willbuy/broker.sock). */
  socketPath?: string;
  /** Connection + read timeout in ms (default: 30_000). */
  timeoutMs?: number;
};

const DEFAULT_SOCKET_PATH = '/run/willbuy/broker.sock';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Send a single capture artifact message to the broker and await the ack.
 *
 * Throws on connection failure, timeout, or framing error. Returns the
 * structured {@link BrokerAck} (which may itself be `ok: false` for
 * schema / byte-cap rejections).
 */
export async function sendToBroker(
  payload: CaptureRequestPayload,
  opts?: BrokerClientOpts,
): Promise<BrokerAck> {
  const socketPath = opts?.socketPath ?? DEFAULT_SOCKET_PATH;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<BrokerAck>((resolve, reject) => {
    const socket = connect(socketPath);

    let settled = false;
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`broker-client: timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const finish = (result: BrokerAck): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    socket.on('error', fail);

    socket.on('connect', () => {
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const framed = frame(body);
      // Write message then half-close (FIN) — broker expects this.
      socket.write(framed, (writeErr) => {
        if (writeErr) {
          fail(writeErr);
          return;
        }
        socket.end();
      });
    });

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
    });

    socket.on('end', () => {
      // Reassemble and parse the framed response.
      const buf = Buffer.concat(chunks, totalBytes);
      if (buf.length < HEADER_BYTES) {
        fail(new Error(`broker-client: short response (${buf.length} bytes)`));
        return;
      }
      const declaredLen = buf.readUInt32BE(0);
      if (buf.length < HEADER_BYTES + declaredLen) {
        fail(
          new Error(
            `broker-client: truncated response (got ${buf.length} bytes, expected ${HEADER_BYTES + declaredLen})`,
          ),
        );
        return;
      }
      const payloadBuf = buf.slice(HEADER_BYTES, HEADER_BYTES + declaredLen);
      let ack: BrokerAck;
      try {
        ack = JSON.parse(payloadBuf.toString('utf8')) as BrokerAck;
      } catch (e) {
        fail(new Error(`broker-client: unparseable ack: ${e instanceof Error ? e.message : String(e)}`));
        return;
      }
      finish(ack);
    });
  });
}
