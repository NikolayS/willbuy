/**
 * studies-constants.test.ts — spec-pin tests for cost constants and ICP
 * presets in routes/studies.ts (spec §5.5, §2 #9).
 *
 * CENTS_PER_VISIT_EST and CENTS_PER_STUDY_CLUSTER_LABEL must match
 * KIND_CEILING values from atomic-spend.ts (spec §5.5 "per-visit hard
 * ceilings"). A divergence between the cost estimate used in the spend
 * reservation call and the ceiling would silently allow over-spend or
 * under-billing.
 *
 * ICP_PRESETS must match the list in web/lib/api-client.ts so the UI and
 * API agree on valid preset IDs without a runtime check.
 *
 * Tests:
 *   1. CENTS_PER_VISIT_EST is 5 (matches KIND_CEILING.visit).
 *   2. CENTS_PER_STUDY_CLUSTER_LABEL is 3 (matches KIND_CEILING.cluster_label).
 *   3. ICP_PRESETS has exactly 5 entries.
 *   4. ICP_PRESETS contains all 5 documented preset IDs.
 *   5. getEtldPlusOne extracts the eTLD+1 from a valid URL.
 *   6. getEtldPlusOne returns null for an invalid input.
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/routes/studies.js';

const { CENTS_PER_VISIT_EST, CENTS_PER_STUDY_CLUSTER_LABEL, ICP_PRESETS, getEtldPlusOne } =
  __test__;

describe('studies cost constants spec-pin (spec §5.5)', () => {
  it('CENTS_PER_VISIT_EST is 5¢ (matches KIND_CEILING.visit)', () => {
    expect(CENTS_PER_VISIT_EST).toBe(5);
  });

  it('CENTS_PER_STUDY_CLUSTER_LABEL is 3¢ (matches KIND_CEILING.cluster_label)', () => {
    expect(CENTS_PER_STUDY_CLUSTER_LABEL).toBe(3);
  });
});

describe('ICP_PRESETS spec-pin (spec §2 #9)', () => {
  it('has exactly 5 ICP presets', () => {
    expect(ICP_PRESETS).toHaveLength(5);
  });

  it('contains all 5 documented preset IDs', () => {
    const ids = [...ICP_PRESETS];
    expect(ids).toContain('saas_founder_pre_pmf');
    expect(ids).toContain('saas_founder_post_pmf');
    expect(ids).toContain('shopify_merchant');
    expect(ids).toContain('devtools_engineer');
    expect(ids).toContain('fintech_ops_buyer');
  });
});

describe('getEtldPlusOne (URL domain extraction)', () => {
  it('extracts eTLD+1 from a valid URL', () => {
    expect(getEtldPlusOne('https://pricing.example.com/page')).toBe('example.com');
  });

  it('returns null for an invalid URL string', () => {
    expect(getEtldPlusOne('not-a-url')).toBeNull();
  });
});
