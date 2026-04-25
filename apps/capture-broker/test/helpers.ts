import { connect, type Socket } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frame, HEADER_BYTES } from '../src/framing.js';
import type { BrokerAck } from '../src/schema.js';

export function tempSocketPath(): string {
  // Unix domain socket paths are limited to ~107 chars on Linux. The
  // OS tmpdir is plenty short on macOS / Linux CI runners.
  const dir = mkdtempSync(join(tmpdir(), 'wb-broker-'));
  return join(dir, 's');
}

/**
 * Send one framed payload to the broker, read one framed response, return
 * the parsed ack. Used by the round-trip + reject tests.
 */
export async function sendOnce(
  socketPath: string,
  payload: Buffer | string,
): Promise<BrokerAck> {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  return roundTrip(socketPath, frame(buf));
}

/**
 * Send raw bytes to the broker (no length-prefixing applied here — caller
 * controls the wire). Used by the duplicate-message test which needs to
 * push two framed messages back-to-back.
 */
export async function sendRaw(socketPath: string, raw: Buffer): Promise<BrokerAck> {
  return roundTrip(socketPath, raw);
}

function roundTrip(socketPath: string, raw: Buffer): Promise<BrokerAck> {
  return new Promise<BrokerAck>((resolve, reject) => {
    const socket: Socket = connect(socketPath);
    const chunks: Buffer[] = [];
    socket.on('error', reject);
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('end', () => {
      const all = Buffer.concat(chunks);
      if (all.length < HEADER_BYTES) {
        reject(new Error(`server closed without writing a frame; got ${all.length}B`));
        return;
      }
      const len = all.readUInt32BE(0);
      const body = all.slice(HEADER_BYTES, HEADER_BYTES + len);
      try {
        resolve(JSON.parse(body.toString('utf8')) as BrokerAck);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    socket.on('connect', () => {
      socket.write(raw);
      socket.end();
    });
  });
}
