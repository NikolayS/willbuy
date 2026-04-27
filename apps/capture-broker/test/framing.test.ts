/**
 * framing.test.ts — unit tests for frame() and readOneFrame() (spec §5.13).
 *
 * readOneFrame is tested with a mock EventEmitter that behaves like a
 * node:net.Socket — no real OS socket or server needed.
 *
 * Scenarios:
 *   1. frame() packs a 4-byte big-endian length header correctly.
 *   2. readOneFrame: happy path — single chunk with full frame.
 *   3. readOneFrame: split header — 4-byte header arriving in two chunks.
 *   4. readOneFrame: split payload — payload arriving in three chunks.
 *   5. readOneFrame: trailing bytes detected (single-shot enforcement).
 *   6. readOneFrame: too_big — declared length exceeds maxPayloadBytes.
 *   7. readOneFrame: closed before header complete → { kind: 'closed' }.
 *   8. readOneFrame: closed after header but before payload → { kind: 'closed' }.
 *   9. readOneFrame: socket error event → { kind: 'error' }.
 *  10. readOneFrame: timeout fires → { kind: 'error', message: 'timeout' }.
 */

import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';

import { frame, HEADER_BYTES, readOneFrame } from '../src/framing.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal Socket-like EventEmitter. The only real methods we need
 * are on/off/emit (EventEmitter) and destroy (no-op for our tests).
 */
function mockSocket(): Socket {
  const ee = new EventEmitter() as Socket;
  (ee as unknown as { destroy: () => void }).destroy = () => {};
  return ee;
}

/** Emit data chunks asynchronously (setImmediate) to simulate async I/O. */
function emitData(sock: Socket, ...chunks: Buffer[]): void {
  for (const c of chunks) {
    setImmediate(() => sock.emit('data', c));
  }
}

function emitEnd(sock: Socket): void {
  setImmediate(() => sock.emit('end'));
}

function emitError(sock: Socket, msg: string): void {
  setImmediate(() => sock.emit('error', new Error(msg)));
}

// ── frame() ───────────────────────────────────────────────────────────────────

describe('frame() — length-prefix packing', () => {
  it('prepends a 4-byte big-endian uint32 length header', () => {
    const payload = Buffer.from('hello');
    const framed = frame(payload);
    expect(framed.length).toBe(HEADER_BYTES + payload.length);
    expect(framed.readUInt32BE(0)).toBe(payload.length);
    expect(framed.slice(HEADER_BYTES).toString()).toBe('hello');
  });

  it('handles an empty payload (length=0)', () => {
    const framed = frame(Buffer.alloc(0));
    expect(framed.length).toBe(HEADER_BYTES);
    expect(framed.readUInt32BE(0)).toBe(0);
  });

  it('handles a large payload length header correctly', () => {
    const payload = Buffer.alloc(65536, 0xab);
    const framed = frame(payload);
    expect(framed.readUInt32BE(0)).toBe(65536);
  });
});

// ── readOneFrame() — happy paths ──────────────────────────────────────────────

describe('readOneFrame() — single-chunk happy path', () => {
  it('full frame in one data chunk → ok with correct payload', async () => {
    const sock = mockSocket();
    const payload = Buffer.from('{"test":1}');
    const framed = frame(payload);

    emitData(sock, framed);
    emitEnd(sock);

    const result = await readOneFrame(sock, 1024 * 1024);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.payload.toString()).toBe('{"test":1}');
      expect(result.trailingBytes).toBe(0);
    }
  });
});

describe('readOneFrame() — split-chunk assembly', () => {
  it('header split across two chunks → assembles correctly', async () => {
    const sock = mockSocket();
    const payload = Buffer.from('split-header');
    const framed = frame(payload);
    // Send first 2 bytes of header, then rest.
    emitData(sock, framed.slice(0, 2), framed.slice(2));
    emitEnd(sock);

    const result = await readOneFrame(sock, 1024 * 1024);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.payload.toString()).toBe('split-header');
    }
  });

  it('payload split across three chunks → assembles correctly', async () => {
    const sock = mockSocket();
    const payload = Buffer.from('ABCDEFGHIJ'); // 10 bytes
    const framed = frame(payload); // 14 bytes total
    // Header whole, payload in three parts.
    const h = framed.slice(0, HEADER_BYTES);
    const p1 = framed.slice(HEADER_BYTES, HEADER_BYTES + 3);
    const p2 = framed.slice(HEADER_BYTES + 3, HEADER_BYTES + 7);
    const p3 = framed.slice(HEADER_BYTES + 7);
    emitData(sock, h, p1, p2, p3);
    emitEnd(sock);

    const result = await readOneFrame(sock, 1024 * 1024);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.payload.toString()).toBe('ABCDEFGHIJ');
      expect(result.trailingBytes).toBe(0);
    }
  });
});

// ── readOneFrame() — trailing bytes (single-shot) ─────────────────────────────

describe('readOneFrame() — trailing bytes detection', () => {
  it('extra byte after declared payload → trailingBytes: 1', async () => {
    const sock = mockSocket();
    const payload = Buffer.from('data');
    const framed = frame(payload);
    // Append an extra byte.
    const withTrailing = Buffer.concat([framed, Buffer.from([0xff])]);
    emitData(sock, withTrailing);

    const result = await readOneFrame(sock, 1024 * 1024);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.trailingBytes).toBe(1);
      expect(result.payload.toString()).toBe('data');
    }
  });
});

// ── readOneFrame() — too_big ──────────────────────────────────────────────────

describe('readOneFrame() — too_big', () => {
  it('declared length > maxPayloadBytes → { kind: too_big }', async () => {
    const sock = mockSocket();
    const payload = Buffer.alloc(200);
    const framed = frame(payload);
    // Only send the header — we don't need the full payload since we stop early.
    emitData(sock, framed.slice(0, HEADER_BYTES));

    const result = await readOneFrame(sock, 100); // max = 100, declared = 200
    expect(result.kind).toBe('too_big');
    if (result.kind === 'too_big') {
      expect(result.declaredLen).toBe(200);
    }
  });
});

// ── readOneFrame() — closed / error ──────────────────────────────────────────

describe('readOneFrame() — socket closed before frame complete', () => {
  it('FIN before header arrives → { kind: closed, bytesRead: 0 }', async () => {
    const sock = mockSocket();
    emitEnd(sock); // EOF with no data at all.

    const result = await readOneFrame(sock, 1024 * 1024);
    expect(result.kind).toBe('closed');
    if (result.kind === 'closed') {
      expect(result.bytesRead).toBe(0);
    }
  });

  it('FIN with partial header (2 bytes) → { kind: closed }', async () => {
    const sock = mockSocket();
    emitData(sock, Buffer.from([0x00, 0x00])); // only 2 of 4 header bytes
    emitEnd(sock);

    const result = await readOneFrame(sock, 1024 * 1024);
    expect(result.kind).toBe('closed');
    if (result.kind === 'closed') {
      expect(result.bytesRead).toBe(2);
    }
  });

  it('FIN with header + partial payload → { kind: closed }', async () => {
    const sock = mockSocket();
    const payload = Buffer.alloc(10);
    const framed = frame(payload);
    // Send header + only half the payload.
    emitData(sock, framed.slice(0, HEADER_BYTES + 5));
    emitEnd(sock);

    const result = await readOneFrame(sock, 1024 * 1024);
    expect(result.kind).toBe('closed');
  });
});

describe('readOneFrame() — socket error', () => {
  it('error event → { kind: error, message }', async () => {
    const sock = mockSocket();
    emitError(sock, 'ECONNRESET');

    const result = await readOneFrame(sock, 1024 * 1024);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('ECONNRESET');
    }
  });
});

describe('readOneFrame() — timeout', () => {
  it('timeout fires before any data → { kind: error, message: timeout }', async () => {
    const sock = mockSocket();
    // Use 1 ms timeout — no data arrives.
    const result = await readOneFrame(sock, 1024 * 1024, 1);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('timeout');
    }
  });
});
