/**
 * icp-presets-pin.test.ts — spec-pin for ICP_PRESETS in studies.ts.
 *
 * ICP_PRESETS are the 5 preset ICP (Ideal Customer Profile) ids from spec §2 #9.
 * These strings are used in the Zod schema for POST /studies — adding or
 * removing a preset silently changes which studies existing API clients can
 * create. Renaming any id (e.g. 'shopify_merchant' → 'shopify') would return
 * 422 for clients using the old id.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/routes/studies.js';

const { ICP_PRESETS } = __test__;

describe('ICP_PRESETS spec-pin (studies.ts — spec §2 #9)', () => {
  it('has exactly 5 presets', () => {
    expect(ICP_PRESETS).toHaveLength(5);
  });

  it('contains "saas_founder_pre_pmf"', () => {
    expect(ICP_PRESETS).toContain('saas_founder_pre_pmf');
  });

  it('contains "saas_founder_post_pmf"', () => {
    expect(ICP_PRESETS).toContain('saas_founder_post_pmf');
  });

  it('contains "shopify_merchant"', () => {
    expect(ICP_PRESETS).toContain('shopify_merchant');
  });

  it('contains "devtools_engineer"', () => {
    expect(ICP_PRESETS).toContain('devtools_engineer');
  });

  it('contains "fintech_ops_buyer"', () => {
    expect(ICP_PRESETS).toContain('fintech_ops_buyer');
  });
});
