/**
 * packs-credits-pin.test.ts — spec-pin for PACKS.credits values (spec §5.6).
 *
 * The existing stripe.test.ts pins PACKS.cents and PACKS.usd inside a
 * describeIfDocker block (requires Docker in CI). The credits values
 * (1000, 4000, 15000) are the core billing value users receive per pack —
 * changing credits without a billing review silently gives users fewer credits
 * for the same price. This test runs without Docker.
 *
 * Also pins that all three pack IDs exist in PACKS.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { PACKS, initPacks } from '../src/billing/packs.js';

// initPacks is normally called by buildServer() at startup; here we
// call it directly with stub price IDs since we only need the numeric values.
beforeAll(() => {
  initPacks({
    starterPriceId: 'price_test_starter',
    growthPriceId: 'price_test_growth',
    scalePriceId: 'price_test_scale',
  });
});

describe('PACKS credits spec-pin (billing/packs.ts — spec §5.6)', () => {
  it('PACKS has exactly 3 pack IDs (starter, growth, scale)', () => {
    expect(Object.keys(PACKS)).toHaveLength(3);
    expect(PACKS).toHaveProperty('starter');
    expect(PACKS).toHaveProperty('growth');
    expect(PACKS).toHaveProperty('scale');
  });

  it('starter credits = 1000', () => {
    expect(PACKS.starter.credits).toBe(1_000);
  });

  it('growth credits = 4000', () => {
    expect(PACKS.growth.credits).toBe(4_000);
  });

  it('scale credits = 15000', () => {
    expect(PACKS.scale.credits).toBe(15_000);
  });

  it('packs are ordered by ascending credits (starter < growth < scale)', () => {
    expect(PACKS.starter.credits).toBeLessThan(PACKS.growth.credits);
    expect(PACKS.growth.credits).toBeLessThan(PACKS.scale.credits);
  });

  it('starter cents = 2900 ($29) — matches web pricing page', () => {
    expect(PACKS.starter.cents).toBe(2_900);
    expect(PACKS.starter.usd).toBe(29);
  });

  it('growth cents = 9900 ($99)', () => {
    expect(PACKS.growth.cents).toBe(9_900);
    expect(PACKS.growth.usd).toBe(99);
  });

  it('scale cents = 29900 ($299)', () => {
    expect(PACKS.scale.cents).toBe(29_900);
    expect(PACKS.scale.usd).toBe(299);
  });
});
