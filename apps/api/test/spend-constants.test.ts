/**
 * spend-constants.test.ts — spec §5.5 billing constant values.
 *
 * The KIND_CEILING values are load-bearing: they gate how many cents can be
 * reserved per provider call. A silent change (e.g. visit 5 → 6) would allow
 * over-billing. These tests pin the values to the spec §5.5 spec values so
 * any regression fails CI rather than silently inflating costs.
 *
 * Also tests that the PACKS credit-tier cents values match the pricing page
 * (spec §5.6 / issue #36). The packs.ts comment says "Starter $29 / Growth $99
 * / Scale $299"; the cents values must be their 100x equivalents.
 *
 * No I/O, no DB, no Docker.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { KIND_CEILING } from '../src/billing/atomic-spend.js';
import { PACKS, initPacks } from '../src/billing/packs.js';

// ── KIND_CEILING — spec §5.5 per-kind hard ceilings ──────────────────────────

describe('KIND_CEILING — spec §5.5 hard per-kind ceilings', () => {
  it('visit ceiling is 5¢ (spec §5.5: 5 cents per visit)', () => {
    expect(KIND_CEILING.visit).toBe(5);
  });

  it('cluster_label ceiling is 3¢ (spec §5.5: 3 cents for LLM cluster-label)', () => {
    expect(KIND_CEILING.cluster_label).toBe(3);
  });

  it('embedding ceiling is 0¢ (spec §5.5: embeddings are zero-cost)', () => {
    expect(KIND_CEILING.embedding).toBe(0);
  });

  it('probe ceiling is 0¢ (spec §5.5: probes are zero-cost)', () => {
    expect(KIND_CEILING.probe).toBe(0);
  });

  it('all four SpendKind values are present (no missing kind)', () => {
    expect(Object.keys(KIND_CEILING).sort()).toEqual(
      ['cluster_label', 'embedding', 'probe', 'visit'],
    );
  });

  it('ceiling object is frozen (values cannot be mutated)', () => {
    expect(() => {
      (KIND_CEILING as Record<string, number>)['visit'] = 99;
    }).toThrow();
  });
});

// ── PACKS — spec §5.6 credit-pack pricing ────────────────────────────────────

describe('PACKS — spec §5.6 credit-tier prices', () => {
  // initPacks must be called before PACKS are usable. In CI the API server
  // always calls it; here we prime with the canonical price IDs.
  const PRICE_IDS = {
    starter: 'price_test_starter',
    growth: 'price_test_growth',
    scale: 'price_test_scale',
  };

  beforeAll(() => {
    initPacks({
      starterPriceId: PRICE_IDS.starter,
      growthPriceId: PRICE_IDS.growth,
      scalePriceId: PRICE_IDS.scale,
    });
  });

  it('starter is $29 (2900¢)', () => {
    expect(PACKS.starter.cents).toBe(2900);
    expect(PACKS.starter.usd).toBe(29);
  });

  it('growth is $99 (9900¢)', () => {
    expect(PACKS.growth.cents).toBe(9900);
    expect(PACKS.growth.usd).toBe(99);
  });

  it('scale is $299 (29900¢)', () => {
    expect(PACKS.scale.cents).toBe(29900);
    expect(PACKS.scale.usd).toBe(299);
  });

  it('all three tiers are present', () => {
    expect(Object.keys(PACKS).sort()).toEqual(['growth', 'scale', 'starter']);
  });

  it('price IDs set by initPacks are accessible', () => {
    expect(PACKS.starter.price_id).toBe(PRICE_IDS.starter);
    expect(PACKS.growth.price_id).toBe(PRICE_IDS.growth);
    expect(PACKS.scale.price_id).toBe(PRICE_IDS.scale);
  });
});
