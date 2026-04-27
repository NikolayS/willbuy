/**
 * schema.test.ts — unit tests for CaptureRequest Zod schema (spec §5.13).
 *
 * The schema is the authoritative wire contract between capture-worker and broker.
 * These tests verify every constraint and the .strict() unknown-field rejection.
 *
 * No I/O, no Docker, no fixtures — pure Zod parse calls.
 */

import { describe, expect, it } from 'vitest';
import { CaptureRequest } from '../src/schema.js';

// ── Valid baseline ────────────────────────────────────────────────────────────

const VALID: CaptureRequest = {
  status: 'ok',
  a11y_tree_b64: 'AAAA',
  banner_selectors_matched: [],
  overlays_unknown_present: false,
  host_count: 0,
};

describe('CaptureRequest — valid baseline', () => {
  it('parses a minimal valid object', () => {
    expect(() => CaptureRequest.parse(VALID)).not.toThrow();
  });

  it('parses with all optional fields present', () => {
    const full: CaptureRequest = {
      ...VALID,
      status: 'blocked',
      screenshot_b64: 'BBBB',
      blocked_reason: 'captcha',
      breach_reason: 'iframe',
      study_id: 42,
      url_hash: 'abc123',
      side: 'A',
    };
    expect(() => CaptureRequest.parse(full)).not.toThrow();
  });
});

// ── status enum ───────────────────────────────────────────────────────────────

describe('CaptureRequest — status enum', () => {
  it('accepts "ok"', () => {
    expect(() => CaptureRequest.parse({ ...VALID, status: 'ok' })).not.toThrow();
  });

  it('accepts "blocked"', () => {
    expect(() => CaptureRequest.parse({ ...VALID, status: 'blocked' })).not.toThrow();
  });

  it('accepts "error"', () => {
    expect(() => CaptureRequest.parse({ ...VALID, status: 'error' })).not.toThrow();
  });

  it('rejects unknown status value', () => {
    expect(() => CaptureRequest.parse({ ...VALID, status: 'timeout' })).toThrow();
  });

  it('rejects missing status', () => {
    const { status: _, ...without } = VALID;
    expect(() => CaptureRequest.parse(without)).toThrow();
  });
});

// ── screenshot_b64 (N5: non-empty when present) ───────────────────────────────

describe('CaptureRequest — screenshot_b64 constraint (N5)', () => {
  it('accepts absent screenshot_b64', () => {
    expect(() => CaptureRequest.parse(VALID)).not.toThrow();
  });

  it('accepts non-empty screenshot_b64', () => {
    expect(() => CaptureRequest.parse({ ...VALID, screenshot_b64: 'BBBB' })).not.toThrow();
  });

  it('rejects empty string screenshot_b64 (N5: must encode at least 1 byte)', () => {
    expect(() => CaptureRequest.parse({ ...VALID, screenshot_b64: '' })).toThrow();
  });
});

// ── host_count ────────────────────────────────────────────────────────────────

describe('CaptureRequest — host_count', () => {
  it('accepts 0', () => {
    expect(() => CaptureRequest.parse({ ...VALID, host_count: 0 })).not.toThrow();
  });

  it('accepts positive integer', () => {
    expect(() => CaptureRequest.parse({ ...VALID, host_count: 10 })).not.toThrow();
  });

  it('rejects negative host_count', () => {
    expect(() => CaptureRequest.parse({ ...VALID, host_count: -1 })).toThrow();
  });

  it('rejects non-integer host_count', () => {
    expect(() => CaptureRequest.parse({ ...VALID, host_count: 1.5 })).toThrow();
  });
});

// ── study_id ──────────────────────────────────────────────────────────────────

describe('CaptureRequest — study_id (optional, positive int)', () => {
  it('accepts absent study_id', () => {
    expect(() => CaptureRequest.parse(VALID)).not.toThrow();
  });

  it('accepts positive integer study_id', () => {
    expect(() => CaptureRequest.parse({ ...VALID, study_id: 1 })).not.toThrow();
  });

  it('rejects zero study_id (must be positive)', () => {
    expect(() => CaptureRequest.parse({ ...VALID, study_id: 0 })).toThrow();
  });

  it('rejects negative study_id', () => {
    expect(() => CaptureRequest.parse({ ...VALID, study_id: -5 })).toThrow();
  });

  it('rejects fractional study_id', () => {
    expect(() => CaptureRequest.parse({ ...VALID, study_id: 1.5 })).toThrow();
  });
});

// ── side enum ─────────────────────────────────────────────────────────────────

describe('CaptureRequest — side enum (A/B study)', () => {
  it('accepts "A"', () => {
    expect(() => CaptureRequest.parse({ ...VALID, side: 'A' })).not.toThrow();
  });

  it('accepts "B"', () => {
    expect(() => CaptureRequest.parse({ ...VALID, side: 'B' })).not.toThrow();
  });

  it('rejects unknown side value', () => {
    expect(() => CaptureRequest.parse({ ...VALID, side: 'C' })).toThrow();
  });
});

// ── .strict() — unknown fields rejected ──────────────────────────────────────

describe('CaptureRequest — .strict() rejects extra fields', () => {
  it('rejects an unknown top-level field', () => {
    expect(() =>
      CaptureRequest.parse({ ...VALID, totally_unknown_field: 'x' }),
    ).toThrow();
  });
});

// ── banner_selectors_matched array ────────────────────────────────────────────

describe('CaptureRequest — banner_selectors_matched', () => {
  it('accepts empty array', () => {
    expect(() => CaptureRequest.parse({ ...VALID, banner_selectors_matched: [] })).not.toThrow();
  });

  it('accepts array of strings', () => {
    expect(() =>
      CaptureRequest.parse({ ...VALID, banner_selectors_matched: ['.cookie-banner', '#gdpr'] }),
    ).not.toThrow();
  });

  it('rejects array containing a non-string', () => {
    expect(() =>
      CaptureRequest.parse({ ...VALID, banner_selectors_matched: ['.ok', 123] }),
    ).toThrow();
  });
});
