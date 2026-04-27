/**
 * packs-icp-labels-pin.test.ts — spec-pins for PACKS (pricing + credits pages)
 * and ICP_LABELS (new study page).
 *
 * PACKS — three copies in three files:
 *   - app/pricing/page.tsx    (marketing page)
 *   - app/dashboard/credits/page.tsx  (dashboard purchase flow)
 *   - components/credits/BuyCredits.tsx  (buy-credits component)
 *
 * All three must stay in sync — if the pricing page shows $99 for Growth
 * but the credits page charges $29, users see inconsistent prices.
 * This test pins the two page-level copies and verifies they agree.
 * (The BuyCredits component copy is covered in a separate PR.)
 *
 * Pinned values per pack:
 *   starter: $29, 1000 credits
 *   growth:  $99, 4000 credits
 *   scale:   $299, 15000 credits
 *
 * ICP_LABELS — human-readable labels for the 5 ICP presets shown in the
 * new-study form dropdown. Changing a label renames what users see without
 * touching the API ICP id, which is acceptable — but an accidental key
 * rename (e.g. 'saas_founder_pre_pmf' → 'saas_pre_pmf') would cause the
 * label to be missing from the dropdown for that preset id.
 */

import { describe, expect, it } from 'vitest';
import { __test__ as pricingTest } from '../app/pricing/page';
import { __test__ as creditsTest } from '../app/dashboard/credits/page';
import { __test__ as newStudyTest } from '../app/dashboard/studies/new/page';

const { PACKS: pricingPacks } = pricingTest;
const { PACKS: creditsPacks } = creditsTest;
const { ICP_LABELS } = newStudyTest;

// ── Pricing page PACKS ────────────────────────────────────────────────────────

describe('PACKS spec-pin (app/pricing/page.tsx)', () => {
  it('has exactly 3 packs', () => {
    expect(pricingPacks).toHaveLength(3);
  });

  it('starter pack: id="starter", usd=29, credits=1000', () => {
    const p = pricingPacks.find((x) => x.id === 'starter');
    expect(p).toBeDefined();
    expect(p!.usd).toBe(29);
    expect(p!.credits).toBe(1_000);
  });

  it('growth pack: id="growth", usd=99, credits=4000', () => {
    const p = pricingPacks.find((x) => x.id === 'growth');
    expect(p).toBeDefined();
    expect(p!.usd).toBe(99);
    expect(p!.credits).toBe(4_000);
  });

  it('scale pack: id="scale", usd=299, credits=15000', () => {
    const p = pricingPacks.find((x) => x.id === 'scale');
    expect(p).toBeDefined();
    expect(p!.usd).toBe(299);
    expect(p!.credits).toBe(15_000);
  });
});

// ── Credits page PACKS ────────────────────────────────────────────────────────

describe('PACKS spec-pin (app/dashboard/credits/page.tsx)', () => {
  it('has exactly 3 packs', () => {
    expect(creditsPacks).toHaveLength(3);
  });

  it('starter pack: usd=29, credits=1000', () => {
    const p = creditsPacks.find((x) => x.id === 'starter');
    expect(p!.usd).toBe(29);
    expect(p!.credits).toBe(1_000);
  });

  it('growth pack: usd=99, credits=4000', () => {
    const p = creditsPacks.find((x) => x.id === 'growth');
    expect(p!.usd).toBe(99);
    expect(p!.credits).toBe(4_000);
  });

  it('scale pack: usd=299, credits=15000', () => {
    const p = creditsPacks.find((x) => x.id === 'scale');
    expect(p!.usd).toBe(299);
    expect(p!.credits).toBe(15_000);
  });
});

// ── Cross-page PACKS consistency ──────────────────────────────────────────────

describe('PACKS cross-page consistency (pricing === credits)', () => {
  it('pricing and credits PACKS have the same pack ids', () => {
    const pricingIds = pricingPacks.map((p) => p.id).sort();
    const creditsIds = creditsPacks.map((p) => p.id).sort();
    expect(pricingIds).toEqual(creditsIds);
  });

  it('pricing and credits PACKS have the same prices', () => {
    for (const pp of pricingPacks) {
      const cp = creditsPacks.find((x) => x.id === pp.id);
      expect(cp).toBeDefined();
      expect(cp!.usd).toBe(pp.usd);
      expect(cp!.credits).toBe(pp.credits);
    }
  });
});

// ── ICP_LABELS ────────────────────────────────────────────────────────────────

describe('ICP_LABELS spec-pin (app/dashboard/studies/new/page.tsx)', () => {
  it('has exactly 5 entries (one per ICP_PRESETS entry)', () => {
    expect(Object.keys(ICP_LABELS)).toHaveLength(5);
  });

  it('"saas_founder_pre_pmf" → "SaaS founder — pre-PMF"', () => {
    expect(ICP_LABELS['saas_founder_pre_pmf']).toBe('SaaS founder — pre-PMF');
  });

  it('"saas_founder_post_pmf" → "SaaS founder — post-PMF"', () => {
    expect(ICP_LABELS['saas_founder_post_pmf']).toBe('SaaS founder — post-PMF');
  });

  it('"shopify_merchant" → "Shopify merchant"', () => {
    expect(ICP_LABELS['shopify_merchant']).toBe('Shopify merchant');
  });

  it('"devtools_engineer" → "Dev-tools engineer"', () => {
    expect(ICP_LABELS['devtools_engineer']).toBe('Dev-tools engineer');
  });

  it('"fintech_ops_buyer" → "Fintech ops buyer"', () => {
    expect(ICP_LABELS['fintech_ops_buyer']).toBe('Fintech ops buyer');
  });
});
