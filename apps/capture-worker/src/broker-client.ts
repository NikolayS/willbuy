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
  /** FK to studies(id); sent in production so broker can write page_captures row. */
  study_id?: number;
  /** Salted SHA-256 of the captured URL (spec §5.12). */
  url_hash?: string;
};

export type BrokerAck =
  | {
      ok: true;
      capture_id: string;
      a11y_object_key: string;
      screenshot_object_key?: string;
      /** Bigint PK of the page_captures row; present when pgCaptureStore is wired. */
      page_capture_id?: number;
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
      // Lifecycle (PR #96 M1 fix, updated #155):
      //   1. Write the framed request. framing.ts readOneFrame resolves as
      //      soon as >= need bytes arrive in the onData handler — no FIN
      //      needed to wake up the broker's read loop.
      //   2. Continue listening on the readable side. Ack bytes arrive while
      //      the connection is still open.
      //   3. Resolve as soon as we have parsed the full length-prefixed ack
      //      (do NOT wait for the broker's 'end'). This removes the
      //      dependency on FIN ordering that the reviewer flagged in M1.
      //   4. Destroy the socket once parsed. 'end' / 'close' are still hooked
      //      as failure paths if the broker drops the connection without
      //      writing a complete ack.
      socket.write(framed, (writeErr) => {
        if (writeErr) {
          fail(writeErr);
          return;
        }
        // No socket.end(): Bun (v1.3.5) socket.end() is a full close (RST) not
        // a half-close (FIN), which causes EPIPE on the broker's ack write.
        // framing.ts now resolves on >= need bytes in onData without needing FIN.
      });
    });

    const tryParse = (): boolean => {
      if (totalBytes < HEADER_BYTES) return false;
      const buf = Buffer.concat(chunks, totalBytes);
      const declaredLen = buf.readUInt32BE(0);
      if (totalBytes < HEADER_BYTES + declaredLen) return false; // need more data

      const payloadBuf = buf.slice(HEADER_BYTES, HEADER_BYTES + declaredLen);
      let ack: BrokerAck;
      try {
        ack = JSON.parse(payloadBuf.toString('utf8')) as BrokerAck;
      } catch (e) {
        fail(new Error(`broker-client: unparseable ack: ${e instanceof Error ? e.message : String(e)}`));
        return true;
      }
      socket.destroy();
      finish(ack);
      return true;
    };

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
      // Length-prefix-driven parse: as soon as `HEADER_BYTES + declaredLen`
      // bytes are buffered we resolve, without waiting for FIN from the
      // broker. This is the M1 hardening from the PR review.
      tryParse();
    });

    socket.on('end', () => {
      // 'end' fires when the broker closes its write side (FIN from broker).
      // Try one final parse; if the data was already complete, this is a
      // no-op because we've already settled in the 'data' handler.
      if (!settled) {
        tryParse();
        if (!settled) {
          fail(new Error(`broker-client: connection closed with ${totalBytes} bytes (expected framed response)`));
        }
      }
    });

    socket.on('close', () => {
      if (!settled) {
        tryParse();
        if (!settled) {
          fail(new Error(`broker-client: socket closed unexpectedly (${totalBytes} bytes received)`));
        }
      }
    });
  });
}

export const __test__ = { DEFAULT_SOCKET_PATH, DEFAULT_TIMEOUT_MS, HEADER_BYTES };
