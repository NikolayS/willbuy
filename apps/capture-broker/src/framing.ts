/**
 * Length-prefixed framing for the broker Unix socket.
 *
 * Wire format: `<u32be length><payload bytes>`. Single message per
 * connection (spec §5.13 single-shot). After the broker writes its ack
 * (same framing) it closes the socket; the client is expected to do the
 * same after sending.
 *
 * Why length-prefixed: the broker reads exactly N bytes, then refuses any
 * trailing data — that's how the "duplicate message rejected" acceptance
 * scenario is enforced cleanly without parsing JSON streams.
 */

import type { Socket } from 'node:net';

export const HEADER_BYTES = 4;

export function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export type ReadFrameResult =
  | { kind: 'ok'; payload: Buffer; trailingBytes: number }
  | { kind: 'too_big'; declaredLen: number }
  | { kind: 'closed'; bytesRead: number }
  | { kind: 'error'; message: string };

/** Default per-connection read timeout in milliseconds (N1). */
export const READ_TIMEOUT_MS = 30_000;

/**
 * Read one length-prefixed frame from `socket` using event listeners
 * (not async iteration — async iteration consumes the readable side in
 * a way that competes with writing the ack back on the same Socket).
 *
 * - Reads exactly `HEADER_BYTES` for the length prefix.
 * - Reads exactly `length` bytes for the payload.
 * - Counts any trailing bytes that arrive after the declared payload —
 *   that's the single-shot detection (spec §5.13). We deliberately do
 *   NOT block waiting for more after we have enough; we resolve as soon
 *   as we have `declaredLen + 1` bytes OR the peer half-closes.
 * - Times out after `timeoutMs` ms (default 30 s, N1) to guard against
 *   peers that send a valid frame but never half-close. On timeout, the
 *   socket is destroyed and the result is `{ kind: 'error', message: 'timeout' }`.
 *
 * `maxPayloadBytes` is a hard ceiling — if the declared length exceeds
 * it, we resolve `too_big` without continuing to read.
 */
export function readOneFrame(
  socket: Socket,
  maxPayloadBytes: number,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<ReadFrameResult> {
  return new Promise<ReadFrameResult>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let resolved = false;
    let declaredLen: number | null = null;

    const timer = setTimeout(() => {
      socket.destroy();
      finish({ kind: 'error', message: 'timeout' });
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('error', onError);
    };

    const finish = (r: ReadFrameResult): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(r);
    };

    const all = (): Buffer => Buffer.concat(chunks, total);

    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      total += chunk.length;

      if (declaredLen === null && total >= HEADER_BYTES) {
        declaredLen = all().readUInt32BE(0);
        if (declaredLen > maxPayloadBytes) {
          finish({ kind: 'too_big', declaredLen });
          return;
        }
      }
      if (declaredLen !== null) {
        const need = HEADER_BYTES + declaredLen;
        // We'd like to detect a trailing byte (single-shot). Wait until we
        // have at least `need + 1` bytes OR the peer half-closes (handled
        // by `onEnd`).
        if (total >= need) {
          const buf = all();
          finish({
            kind: 'ok',
            payload: buf.slice(HEADER_BYTES, need),
            trailingBytes: total - need,
          });
        }
      }
    };

    const onEnd = (): void => {
      if (declaredLen === null) {
        finish({ kind: 'closed', bytesRead: total });
        return;
      }
      const need = HEADER_BYTES + declaredLen;
      if (total < need) {
        finish({ kind: 'closed', bytesRead: total });
        return;
      }
      const buf = all();
      finish({
        kind: 'ok',
        payload: buf.slice(HEADER_BYTES, need),
        trailingBytes: total - need,
      });
    };

    const onError = (err: Error): void => {
      finish({ kind: 'error', message: err.message });
    };

    socket.on('data', onData);
    socket.on('end', onEnd);
    socket.on('error', onError);
  });
}
