/**
 * schema.test.ts — spec-pins for CaptureRequest shape (spec §5.13).
 *
 * The `status` enum ('ok', 'blocked', 'error') and `side` enum ('A', 'B')
 * in CaptureRequest are the only finite-set constraints in the schema that
 * are not covered by the acceptance tests in server.test.ts. Adding a new
 * status value (e.g., 'timeout') without updating the aggregator's
 * expected statuses would cause silent data loss.
 */

import { describe, expect, it } from 'vitest';

import { CaptureRequest } from '../src/schema.js';

const BASE: Record<string, unknown> = {
  status: 'ok',
  a11y_tree_b64: Buffer.from('{"role":"document","children":[]}', 'utf8').toString('base64'),
  banner_selectors_matched: [],
  overlays_unknown_present: false,
  host_count: 1,
};

describe('CaptureRequest.status enum spec-pin (spec §5.13)', () => {
  it('accepts "ok"', () => {
    expect(() => CaptureRequest.parse({ ...BASE, status: 'ok' })).not.toThrow();
  });

  it('accepts "blocked"', () => {
    expect(() => CaptureRequest.parse({ ...BASE, status: 'blocked' })).not.toThrow();
  });

  it('accepts "error"', () => {
    expect(() => CaptureRequest.parse({ ...BASE, status: 'error' })).not.toThrow();
  });

  it('rejects an unknown status value', () => {
    expect(() => CaptureRequest.parse({ ...BASE, status: 'timeout' })).toThrow();
    expect(() => CaptureRequest.parse({ ...BASE, status: 'unknown' })).toThrow();
    expect(() => CaptureRequest.parse({ ...BASE, status: '' })).toThrow();
  });
});

describe('CaptureRequest.side enum spec-pin (spec §5.13)', () => {
  it('accepts "A"', () => {
    expect(() => CaptureRequest.parse({ ...BASE, side: 'A' })).not.toThrow();
  });

  it('accepts "B"', () => {
    expect(() => CaptureRequest.parse({ ...BASE, side: 'B' })).not.toThrow();
  });

  it('is optional — absent means single-URL (not A/B)', () => {
    const r = CaptureRequest.parse(BASE);
    expect(r.side).toBeUndefined();
  });

  it('rejects "C" and other non-A/B values', () => {
    expect(() => CaptureRequest.parse({ ...BASE, side: 'C' })).toThrow();
    expect(() => CaptureRequest.parse({ ...BASE, side: 'a' })).toThrow();
  });
});
