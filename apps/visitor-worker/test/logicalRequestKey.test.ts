import { describe, expect, it } from 'vitest';

import * as visitorWorker from '../src/index.js';

// Issue #23 / B1 (spec §5.15 line 253, §5.1 step 7 line 131, §2 #15):
//   logical_request_key = sha256(
//     visit_id || provider || model || request_kind || repair_generation
//   )
//
// The function is exported from the package BARREL so other packages
// (notably the API server's spend ledger and the daily reconciliation
// job — see §2 #16 `provider_attempts.logical_request_key UNIQUE` +
// `model`) can compute the same key without reaching into internals.
//
// Properties:
//   (a) byte-identical for the same (visitId, providerName, modelName,
//       generation) — so transport retries inside the adapter share a
//       key and provider-side idempotency dedupes;
//   (b) differs across repair_generation values — schema-repair = NEW
//       logical key (semantically a fresh logical request);
//   (c) differs across visitId values (same generation);
//   (d) differs across providerName values (same visit, same generation);
//   (e) differs across modelName values (same visit, same provider, same
//       generation) — guards the §5.15 collision case where two visits
//       run against the same provider but a bumped model would otherwise
//       reuse a provider-side Idempotency-Key.

describe('@willbuy/visitor-worker barrel — computeLogicalRequestKey is publicly exported with stable semantics (incl. model component per spec §5.15)', () => {
  it('is exported from the package index entrypoint', () => {
    expect(typeof visitorWorker.computeLogicalRequestKey).toBe('function');
  });

  it('returns a byte-identical hex digest for the same (visitId, providerName, modelName, repair_generation)', () => {
    const a = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      'mock-model',
      0,
    );
    const b = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      'mock-model',
      0,
    );
    expect(a).toBe(b);
    // Sanity: it is a hex sha256 — 64 lowercase hex chars.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns DIFFERENT keys for different repair_generation values (same visit, same model)', () => {
    const gen0 = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      'mock-model',
      0,
    );
    const gen1 = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      'mock-model',
      1,
    );
    const gen2 = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      'mock-model',
      2,
    );
    expect(gen0).not.toBe(gen1);
    expect(gen1).not.toBe(gen2);
    expect(gen0).not.toBe(gen2);
  });

  it('returns DIFFERENT keys for different visitId values (same generation, same model)', () => {
    const a = visitorWorker.computeLogicalRequestKey(
      'visit-X',
      'mock-provider',
      'mock-model',
      0,
    );
    const b = visitorWorker.computeLogicalRequestKey(
      'visit-Y',
      'mock-provider',
      'mock-model',
      0,
    );
    expect(a).not.toBe(b);
  });

  it('returns DIFFERENT keys for different provider names (same visit, same generation, same model)', () => {
    const a = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'provider-A',
      'mock-model',
      0,
    );
    const b = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'provider-B',
      'mock-model',
      0,
    );
    expect(a).not.toBe(b);
  });

  it('returns DIFFERENT keys for different model names (same visit, same provider, same generation) — spec §5.15 model component', () => {
    const a = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      'model-v1',
      0,
    );
    const b = visitorWorker.computeLogicalRequestKey(
      'visit-acc-5',
      'mock-provider',
      'model-v2',
      0,
    );
    expect(a).not.toBe(b);
  });
});
