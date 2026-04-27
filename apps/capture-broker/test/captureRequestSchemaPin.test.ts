/**
 * captureRequestSchemaPin.test.ts — standalone unit tests for the
 * CaptureRequest schema (spec §5.13). No network/socket needed.
 *
 * The existing server.test.ts verifies schema validation via a real
 * Unix-socket roundtrip (Docker-gated). This file pins the schema
 * contract directly so CI catches regressions without Docker.
 *
 * Key constraints from spec §5.13:
 *   - status ∈ {ok, blocked, error}
 *   - screenshot_b64 optional but must be ≥ 1 char if present (N5)
 *   - side ∈ {A, B} optional
 *   - strict() — unknown top-level fields rejected
 */

import { describe, it, expect } from 'vitest';
import { CaptureRequest } from '../src/schema.js';

const VALID_BASE: Parameters<typeof CaptureRequest.parse>[0] = {
  status: 'ok',
  a11y_tree_b64: 'dGVzdA==',
  banner_selectors_matched: [],
  overlays_unknown_present: false,
  host_count: 3,
};

describe('CaptureRequest — status enum (spec §5.13)', () => {
  for (const s of ['ok', 'blocked', 'error'] as const) {
    it(`accepts status="${s}"`, () => {
      expect(CaptureRequest.safeParse({ ...VALID_BASE, status: s }).success).toBe(true);
    });
  }

  it('rejects unknown status value', () => {
    expect(CaptureRequest.safeParse({ ...VALID_BASE, status: 'timeout' }).success).toBe(false);
  });
});

describe('CaptureRequest — screenshot_b64 min=1 constraint (N5)', () => {
  it('accepts screenshot_b64 when absent (optional)', () => {
    const { screenshot_b64: _, ...withoutScreenshot } = { ...VALID_BASE, screenshot_b64: 'dA==' };
    const r = CaptureRequest.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('accepts screenshot_b64 with 1+ chars', () => {
    const r = CaptureRequest.safeParse({ ...VALID_BASE, screenshot_b64: 'dA==' });
    expect(r.success).toBe(true);
  });

  it('rejects screenshot_b64 as empty string (N5 — min=1)', () => {
    const r = CaptureRequest.safeParse({ ...VALID_BASE, screenshot_b64: '' });
    expect(r.success).toBe(false);
  });
});

describe('CaptureRequest — side enum (optional, spec §5.13)', () => {
  it('accepts side="A"', () => {
    expect(CaptureRequest.safeParse({ ...VALID_BASE, side: 'A' }).success).toBe(true);
  });

  it('accepts side="B"', () => {
    expect(CaptureRequest.safeParse({ ...VALID_BASE, side: 'B' }).success).toBe(true);
  });

  it('accepts missing side (optional)', () => {
    expect(CaptureRequest.safeParse(VALID_BASE).success).toBe(true);
  });

  it('rejects unknown side value', () => {
    expect(CaptureRequest.safeParse({ ...VALID_BASE, side: 'C' }).success).toBe(false);
  });
});

describe('CaptureRequest — strict() rejects unknown fields', () => {
  it('rejects a request with an unknown top-level field', () => {
    const r = CaptureRequest.safeParse({ ...VALID_BASE, unknown_field: 'oops' });
    expect(r.success).toBe(false);
  });
});
