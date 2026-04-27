/**
 * brokerClient.test.ts — unit tests for broker-client.ts (spec §5.13).
 *
 * sendToBroker() opens a Unix-socket connection, writes a length-prefixed
 * JSON request, reads the framed ack, and returns the parsed BrokerAck.
 *
 * Each test spins up a minimal net.Server on a temp socket path so we can
 * control exactly what the broker side does — no real capture-broker binary.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { sendToBroker, type CaptureRequestPayload } from '../src/broker-client.js';

// ── helpers ────────────────────────────────────────────────────────────────────

const HEADER_BYTES = 4;

function writeFrame(socket: Socket, obj: unknown): void {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

const FIXTURE_PAYLOAD: CaptureRequestPayload = {
  status: 'ok',
  a11y_tree_b64: 'dGVzdA==',
  banner_selectors_matched: [],
  overlays_unknown_present: false,
  host_count: 1,
};

let sockSeq = 0;
function tmpSock(): string {
  return join(tmpdir(), `wb-broker-test-${process.pid}-${++sockSeq}.sock`);
}

const servers: Server[] = [];
const serverConnections: Set<Socket> = new Set();

function startServer(sockPath: string, handler: (socket: Socket) => void): Promise<void> {
  return new Promise((resolve) => {
    const srv = createServer((socket) => {
      serverConnections.add(socket);
      socket.once('close', () => serverConnections.delete(socket));
      handler(socket);
    });
    servers.push(srv);
    srv.listen(sockPath, resolve);
  });
}

afterEach(async () => {
  // Destroy all active server-side connections so server.close() doesn't hang.
  for (const s of serverConnections) s.destroy();
  serverConnections.clear();
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers.length = 0;
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('sendToBroker (spec §5.13)', () => {
  it('resolves with ok:true ack on a successful round-trip', async () => {
    const sockPath = tmpSock();
    const okAck = { ok: true, capture_id: 'cap-001', a11y_object_key: 's3://bucket/a11y/001.json' };

    await startServer(sockPath, (socket) => {
      socket.once('data', () => writeFrame(socket, okAck));
    });

    const result = await sendToBroker(FIXTURE_PAYLOAD, { socketPath: sockPath });
    expect(result).toEqual(okAck);
  });

  it('resolves with ok:false ack when broker reports schema rejection', async () => {
    const sockPath = tmpSock();
    const errAck = { ok: false, error: 'schema_invalid', detail: 'missing field' };

    await startServer(sockPath, (socket) => {
      socket.once('data', () => writeFrame(socket, errAck));
    });

    const result = await sendToBroker(FIXTURE_PAYLOAD, { socketPath: sockPath });
    expect(result).toEqual(errAck);
  });

  it('rejects when the broker sends unparseable JSON', async () => {
    const sockPath = tmpSock();

    await startServer(sockPath, (socket) => {
      socket.once('data', () => {
        const body = Buffer.from('not valid json!!!');
        const header = Buffer.alloc(HEADER_BYTES);
        header.writeUInt32BE(body.length, 0);
        socket.write(Buffer.concat([header, body]));
      });
    });

    await expect(
      sendToBroker(FIXTURE_PAYLOAD, { socketPath: sockPath }),
    ).rejects.toThrow(/unparseable ack/i);
  });

  it('rejects when the broker closes the connection without writing an ack', async () => {
    const sockPath = tmpSock();

    await startServer(sockPath, (socket) => {
      socket.once('data', () => socket.end());
    });

    await expect(
      sendToBroker(FIXTURE_PAYLOAD, { socketPath: sockPath }),
    ).rejects.toThrow(/connection closed|socket closed/i);
  });

  it('rejects when the socket path does not exist (ENOENT)', async () => {
    const nonExistentPath = join(tmpdir(), `no-such-broker-${Date.now()}.sock`);
    await expect(
      sendToBroker(FIXTURE_PAYLOAD, { socketPath: nonExistentPath }),
    ).rejects.toThrow();
  });

  it('rejects with a timeout error when the broker never responds', async () => {
    const sockPath = tmpSock();

    await startServer(sockPath, (_socket) => {
      // Intentionally idle — never writes an ack.
    });

    await expect(
      sendToBroker(FIXTURE_PAYLOAD, { socketPath: sockPath, timeoutMs: 150 }),
    ).rejects.toThrow(/timeout/i);
  }, 5_000);

  it('forwards the request payload as a correctly-framed JSON message', async () => {
    const sockPath = tmpSock();
    let receivedPayload: unknown = null;

    await startServer(sockPath, (socket) => {
      const chunks: Buffer[] = [];
      let total = 0;
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        total += chunk.length;
        const buf = Buffer.concat(chunks, total);
        if (buf.length < HEADER_BYTES) return;
        const len = buf.readUInt32BE(0);
        if (buf.length < HEADER_BYTES + len) return;
        receivedPayload = JSON.parse(buf.slice(HEADER_BYTES, HEADER_BYTES + len).toString('utf8'));
        writeFrame(socket, { ok: true, capture_id: 'x', a11y_object_key: 'k' });
      });
    });

    await sendToBroker(FIXTURE_PAYLOAD, { socketPath: sockPath });
    expect(receivedPayload).toMatchObject({ status: 'ok', host_count: 1 });
  });

  it('resolves without waiting for broker to close the connection (no-FIN semantics)', async () => {
    // The broker writes the ack but intentionally keeps the socket open.
    const sockPath = tmpSock();
    let openSocket: Socket | null = null;

    await startServer(sockPath, (socket) => {
      openSocket = socket;
      socket.once('data', () => {
        writeFrame(socket, { ok: true, capture_id: 'x', a11y_object_key: 'k' });
        // Deliberately NOT calling socket.end() — connection stays open.
      });
    });

    const result = await sendToBroker(FIXTURE_PAYLOAD, { socketPath: sockPath });
    expect(result).toMatchObject({ ok: true, capture_id: 'x' });
    openSocket?.destroy();
  });
});
