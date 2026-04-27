/**
 * framingRedactorConstantsPin.test.ts — spec-pin for broker wire protocol
 * and redactor constants (spec §5.9, §5.13).
 *
 * These values are used in existing tests but their numeric/symbolic values
 * are never directly asserted. Changing them silently breaks the wire protocol
 * or the redactor's labeled-context window.
 *
 * Spec refs:
 *   §5.13  — Unix socket framing (u32be length prefix = 4 bytes).
 *   §5.9   — Redactor versioning (REDACTOR_VERSION persisted on capture row).
 *   §5.13  — Read timeout 30 s.
 *   §5.9   — LABEL_PROXIMITY_CHARS controls labeled-secret detection window.
 */

import { describe, it, expect } from 'vitest';
import { HEADER_BYTES, READ_TIMEOUT_MS } from '../src/framing.js';
import { REDACTOR_VERSION, LABEL_PROXIMITY_CHARS } from '../src/redactor.js';
import { SOCKET_MODE } from '../src/server.js';

describe('Framing constants — spec §5.13', () => {
  it('HEADER_BYTES is 4 (u32be length prefix)', () => {
    expect(HEADER_BYTES).toBe(4);
  });

  it('READ_TIMEOUT_MS is 30 000 ms (30 s)', () => {
    expect(READ_TIMEOUT_MS).toBe(30_000);
  });
});

describe('Redactor constants — spec §5.9', () => {
  it('REDACTOR_VERSION is 1', () => {
    expect(REDACTOR_VERSION).toBe(1);
  });

  it('LABEL_PROXIMITY_CHARS is 32', () => {
    expect(LABEL_PROXIMITY_CHARS).toBe(32);
  });
});

describe('Server constants — spec §5.13', () => {
  it('SOCKET_MODE is 0o660 (rw-rw---- so worker can connect without root)', () => {
    expect(SOCKET_MODE).toBe(0o660);
  });
});
