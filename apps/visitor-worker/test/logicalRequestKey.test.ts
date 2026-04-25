import { describe, expect, it } from 'vitest';

import * as visitorWorker from '../src/index.js';

// Issue #9 acceptance #5 (spec §5.15): logical_request_key is
// sha256(visitId || providerName || 'visit' || repair_generation).
// The function is exported from the package BARREL so other packages
// (notably the API server's spend ledger and the daily reconciliation
// job) can compute the same key without reaching into internals.
//
// Properties:
//   (a) byte-identical for the same (visitId, providerName, generation) —
//       so transport retries inside the adapter share a key and provider-
//       side idempotency dedupes;
//   (b) differs across repair_generation values — schema-repair = NEW
//       logical key (semantically a fresh logical request);
//   (c) differs across visitId values (same generation);
//   (d) differs across providerName values (same visit, same generation).

describe('@willbuy/visitor-worker barrel — acceptance #5: computeLogicalRequestKey is publicly exported with stable semantics', () => {
  it('is exported from the package index entrypoint', () => {
    expect(typeof visitorWorker.computeLogicalRequestKey).toBe('function');
  });

  it('returns a byte-identical hex digest for the same (visitId, providerName, repair_generation)', () => {
    const a = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      0,
    );
    const b = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      0,
    );
    expect(a).toBe(b);
    // Sanity: it is a hex sha256 — 64 lowercase hex chars.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns DIFFERENT keys for different repair_generation values (same visit)', () => {
    const gen0 = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      0,
    );
    const gen1 = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      1,
    );
    const gen2 = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      2,
    );
    expect(gen0).not.toBe(gen1);
    expect(gen1).not.toBe(gen2);
    expect(gen0).not.toBe(gen2);
  });

  it('returns DIFFERENT keys for different visitId values (same generation)', () => {
    const a = visitorWorker.computeLogicalRequestKey(
      'visit-X',
      'mock-provider',
      0,
    );
    const b = visitorWorker.computeLogicalRequestKey(
      'visit-Y',
      'mock-provider',
      0,
    );
    expect(a).not.toBe(b);
  });

  it('returns DIFFERENT keys for different provider names (same visit, same generation)', () => {
    const a = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'provider-A',
      0,
    );
    const b = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'provider-B',
      0,
    );
    expect(a).not.toBe(b);
  });
});
