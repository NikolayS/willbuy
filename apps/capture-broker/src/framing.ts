// RED stub. Implementation lands in the green commit.

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

export function readOneFrame(
  _socket: Socket,
  _maxPayloadBytes: number,
): Promise<ReadFrameResult> {
  return Promise.reject(new Error('readOneFrame not implemented'));
}
