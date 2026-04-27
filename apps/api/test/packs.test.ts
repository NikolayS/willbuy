/**
 * packs.test.ts — unit tests for initPacks() / PACKS (billing/packs.ts).
 *
 * The Stripe credit-pack definitions are set from env via initPacks() at
 * server startup. The PACKS proxy throws if accessed before initialization.
 * These behaviors are exercised only through the integration test (which calls
 * buildServer() which calls initPacks()), never in isolation.
 */

import { describe, expect, it, beforeEach } from 'vitest';

// We re-import the module fresh for each test to avoid the singleton state
// from initPacks() carrying over from other test files.

describe('initPacks() / PACKS (billing/packs.ts)', () => {
  // Module state resets between test files in vitest (each file gets a fresh
  // module registry), but not between tests in the same file. We always call
  // initPacks() before accessing PACKS to ensure a known state.

  it('initPacks() sets all three pack price_ids, cents, and usd', async () => {
    const { initPacks, PACKS } = await import('../src/billing/packs.js');
    initPacks({
      starterPriceId: 'price_starter_test',
      growthPriceId: 'price_growth_test',
      scalePriceId: 'price_scale_test',
    });
    expect(PACKS.starter.price_id).toBe('price_starter_test');
    expect(PACKS.starter.cents).toBe(2900);
    expect(PACKS.starter.usd).toBe(29);
    expect(PACKS.starter.credits).toBe(1000);

    expect(PACKS.growth.price_id).toBe('price_growth_test');
    expect(PACKS.growth.cents).toBe(9900);
    expect(PACKS.growth.usd).toBe(99);

    expect(PACKS.scale.price_id).toBe('price_scale_test');
    expect(PACKS.scale.cents).toBe(29900);
    expect(PACKS.scale.usd).toBe(299);
  });

  it('PACKS proxy exposes starter, growth, scale via has()', async () => {
    const { initPacks, PACKS } = await import('../src/billing/packs.js');
    initPacks({ starterPriceId: 'a', growthPriceId: 'b', scalePriceId: 'c' });
    expect('starter' in PACKS).toBe(true);
    expect('growth' in PACKS).toBe(true);
    expect('scale' in PACKS).toBe(true);
    expect('unknown' in PACKS).toBe(false);
  });

  it('initPacks() is idempotent — last call wins', async () => {
    const { initPacks, PACKS } = await import('../src/billing/packs.js');
    initPacks({ starterPriceId: 'first', growthPriceId: 'x', scalePriceId: 'y' });
    initPacks({ starterPriceId: 'second', growthPriceId: 'x', scalePriceId: 'y' });
    expect(PACKS.starter.price_id).toBe('second');
  });
});
