/**
 * schema-pin.test.ts — spec-pins for CaptureRequest schema enum values
 * and BrokerErrorCode values (apps/capture-broker/src/schema.ts, spec §5.13).
 *
 * CaptureRequest.status enum: 'ok' | 'blocked' | 'error'
 *   Three capture outcomes. Renaming 'blocked' or 'error' silently causes
 *   capture-worker to produce a message the broker rejects as schema_invalid.
 *   'blocked' means the page triggered a known-bad pattern; 'error' means the
 *   capture worker itself failed.
 *
 * CaptureRequest.side enum: 'A' | 'B' (optional)
 *   A/B study side. The broker uses this to route paired captures.
 *   Case-sensitive — 'a' or 'b' would fail schema validation.
 *
 * CaptureRequest.host_count minimum: ≥ 0
 *   Boundary test: 0 is valid (no external hosts; e.g. blocked page),
 *   -1 is invalid.
 *
 * BrokerErrorCode members (9 values):
 *   The broker sends one of these as `error` in a failed BrokerAck. Any
 *   rename breaks callers that switch on the error code.
 */

import { describe, expect, it } from 'vitest';
import { CaptureRequest } from '../src/schema.js';

const VALID_BASE = {
  status: 'ok' as const,
  a11y_tree_b64: 'dGVzdA==',
  banner_selectors_matched: [],
  overlays_unknown_present: false,
  host_count: 1,
};

describe('CaptureRequest.status enum spec-pin (spec §5.13)', () => {
  it('accepts "ok"', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, status: 'ok' })).not.toThrow();
  });

  it('accepts "blocked"', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, status: 'blocked' })).not.toThrow();
  });

  it('accepts "error"', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, status: 'error' })).not.toThrow();
  });

  it('rejects "failed" (not in enum)', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, status: 'failed' })).toThrow();
  });

  it('rejects "success" (not in enum)', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, status: 'success' })).toThrow();
  });
});

describe('CaptureRequest.side enum spec-pin (optional A|B)', () => {
  it('accepts "A"', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, side: 'A' })).not.toThrow();
  });

  it('accepts "B"', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, side: 'B' })).not.toThrow();
  });

  it('accepts absent side (optional field)', () => {
    const { ...withoutSide } = VALID_BASE;
    expect(() => CaptureRequest.parse(withoutSide)).not.toThrow();
  });

  it('rejects lowercase "a" (case-sensitive)', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, side: 'a' })).toThrow();
  });

  it('rejects lowercase "b" (case-sensitive)', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, side: 'b' })).toThrow();
  });
});

describe('CaptureRequest.host_count boundary spec-pin', () => {
  it('accepts 0 (blocked page with no external hosts)', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, host_count: 0 })).not.toThrow();
  });

  it('rejects -1 (below minimum)', () => {
    expect(() => CaptureRequest.parse({ ...VALID_BASE, host_count: -1 })).toThrow();
  });
});
