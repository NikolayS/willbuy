/**
 * api-client-constants.test.ts — spec-pins for ICP_PRESETS and STUDY_STATUSES
 * exported from apps/web/lib/api-client.ts.
 *
 * ICP_PRESETS (5 entries):
 *   These must mirror ICP_PRESETS in apps/api/src/routes/studies.ts — the API
 *   validates against the same list. A mismatch means the web form accepts an
 *   ICP id that the API then rejects with a 422. Adding a preset here without
 *   adding it to the API also causes 422s at submission.
 *
 * STUDY_STATUSES (6 entries, spec §5.3):
 *   The status state machine: pending → capturing → visiting → aggregating →
 *   ready | failed. Removing any status would make STATUS_LABELS['<status>']
 *   return undefined (rendered as "" on the status page). Adding a status
 *   without adding a label would also render undefined. Tests for
 *   STATUS_LABELS completeness in study-status-labels.test.ts depend on
 *   STUDY_STATUSES being exactly these 6 strings.
 */

import { describe, expect, it } from 'vitest';
import { ICP_PRESETS, STUDY_STATUSES } from '../lib/api-client';

describe('ICP_PRESETS spec-pin (lib/api-client.ts — must mirror API route)', () => {
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

describe('STUDY_STATUSES spec-pin (lib/api-client.ts — spec §5.3)', () => {
  it('has exactly 6 statuses', () => {
    expect(STUDY_STATUSES).toHaveLength(6);
  });

  it('contains "pending"', () => {
    expect(STUDY_STATUSES).toContain('pending');
  });

  it('contains "capturing"', () => {
    expect(STUDY_STATUSES).toContain('capturing');
  });

  it('contains "visiting"', () => {
    expect(STUDY_STATUSES).toContain('visiting');
  });

  it('contains "aggregating"', () => {
    expect(STUDY_STATUSES).toContain('aggregating');
  });

  it('contains "ready"', () => {
    expect(STUDY_STATUSES).toContain('ready');
  });

  it('contains "failed"', () => {
    expect(STUDY_STATUSES).toContain('failed');
  });
});
