/**
 * metrics-counters.test.ts — unit tests for the metric emission functions
 * exported from metrics/registry.ts that were not covered by metrics.test.ts.
 *
 * metrics.test.ts covers: GET /metrics auth gating, recordStudyStarted,
 * HTTP-request histogram, and route-label parameterisation.
 *
 * This suite covers the remaining counter and gauge emission functions:
 *   recordStudyCompleted  — studiesCompletedTotal{kind,outcome}
 *   recordVisit           — visitsTotal{persona_pool}
 *   recordCreditsConsumed — creditsConsumedTotal{kind}
 *   setActiveStudies      — activeStudies gauge
 *
 * All assertions use renderExposition() to observe counter state without
 * building a full Fastify app.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  recordStudyCompleted,
  recordVisit,
  recordCreditsConsumed,
  setActiveStudies,
  renderExposition,
  resetMetricsForTesting,
} from '../src/metrics/registry.js';

beforeEach(() => {
  resetMetricsForTesting();
});

// ── recordStudyCompleted ──────────────────────────────────────────────────────

describe('recordStudyCompleted()', () => {
  it('increments willbuy_studies_completed_total with kind + outcome labels', () => {
    recordStudyCompleted({ kind: 'single', outcome: 'ok' });
    const exp = renderExposition();
    expect(exp).toMatch(/willbuy_studies_completed_total\{[^}]*kind="single"[^}]*outcome="ok"/);
  });

  it('paired/failed combination appears in exposition', () => {
    recordStudyCompleted({ kind: 'paired', outcome: 'failed' });
    const exp = renderExposition();
    expect(exp).toMatch(/willbuy_studies_completed_total\{[^}]*kind="paired"[^}]*outcome="failed"/);
  });

  it('increments by 1 per call', () => {
    recordStudyCompleted({ kind: 'single', outcome: 'partial' });
    recordStudyCompleted({ kind: 'single', outcome: 'partial' });
    const exp = renderExposition();
    // Value should be 2
    expect(exp).toMatch(/willbuy_studies_completed_total\{[^}]*kind="single"[^}]*outcome="partial"[^}]*\} 2/);
  });
});

// ── recordVisit ───────────────────────────────────────────────────────────────

describe('recordVisit()', () => {
  it('increments willbuy_visits_total with persona_pool label', () => {
    recordVisit({ persona_pool: 'saas_founder_pre_pmf' });
    const exp = renderExposition();
    expect(exp).toMatch(/willbuy_visits_total\{[^}]*persona_pool="saas_founder_pre_pmf"/);
  });

  it('custom persona_pool is recorded verbatim', () => {
    recordVisit({ persona_pool: 'custom' });
    const exp = renderExposition();
    expect(exp).toMatch(/willbuy_visits_total\{[^}]*persona_pool="custom"/);
  });

  it('separate persona pools track independently', () => {
    recordVisit({ persona_pool: 'devtools_engineer' });
    recordVisit({ persona_pool: 'devtools_engineer' });
    recordVisit({ persona_pool: 'shopify_merchant' });
    const exp = renderExposition();
    expect(exp).toMatch(/willbuy_visits_total\{[^}]*persona_pool="devtools_engineer"[^}]*\} 2/);
    expect(exp).toMatch(/willbuy_visits_total\{[^}]*persona_pool="shopify_merchant"[^}]*\} 1/);
  });
});

// ── recordCreditsConsumed ─────────────────────────────────────────────────────

describe('recordCreditsConsumed()', () => {
  it('increments willbuy_credits_consumed_total by the cents value', () => {
    recordCreditsConsumed({ kind: 'single', cents: 5 });
    const exp = renderExposition();
    expect(exp).toMatch(/willbuy_credits_consumed_total\{[^}]*kind="single"[^}]*\} 5/);
  });

  it('accumulates across multiple calls', () => {
    recordCreditsConsumed({ kind: 'paired', cents: 10 });
    recordCreditsConsumed({ kind: 'paired', cents: 3 });
    const exp = renderExposition();
    expect(exp).toMatch(/willbuy_credits_consumed_total\{[^}]*kind="paired"[^}]*\} 13/);
  });
});

// ── setActiveStudies ──────────────────────────────────────────────────────────

describe('setActiveStudies()', () => {
  it('sets willbuy_active_studies gauge to the given value', () => {
    setActiveStudies(7);
    const exp = renderExposition();
    // The gauge line may or may not have labels; match both forms.
    expect(exp).toMatch(/willbuy_active_studies(?:\{[^}]*\})?\s+7/);
  });

  it('overwrites the previous value (gauge, not counter)', () => {
    setActiveStudies(5);
    setActiveStudies(2);
    const exp = renderExposition();
    // Should reflect the most recent value (2), not the accumulated total (7).
    expect(exp).toMatch(/willbuy_active_studies(?:\{[^}]*\})?\s+2/);
    expect(exp).not.toMatch(/willbuy_active_studies(?:\{[^}]*\})?\s+5/);
  });
});
