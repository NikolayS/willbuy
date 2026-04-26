// canary-smoke.test.ts — assertion-logic for the browser-stack patch SLO
// canary (issue #124, spec §2 #4 + §5.16).
//
// The canary script (scripts/canary/staging-browser-canary.sh) drives a
// real Playwright browser against a known-good fixture URL and feeds the
// resulting CaptureResult into compareCanaryToBaseline. This test
// exercises the assertion-logic helper with stub fixtures only; it does
// NOT launch a browser. The browser-launch path is covered by the
// existing captureGolden / smoke tests.

import { describe, it, expect } from 'vitest';
import {
  compareCanaryToBaseline,
  type CanaryBaseline,
} from '../src/canary.js';
import type { CaptureResult } from '../src/types.js';

const BASELINE: CanaryBaseline = {
  expectedStatus: 'ok',
  // Substrings the rendered a11y tree (JSON-stringified) must contain.
  // The canary target is /r/test-fixture (the report page rendered with
  // WILLBUY_REPORT_FIXTURE=enabled), not the marketing pricing page —
  // see scripts/canary/run-canary.ts. Phrases below are the structural
  // anchors of the report view (spec §5.18): two h2 headings, the
  // headline-stat label (which exercises the Δ codepoint round-trip),
  // and the study slug (proves the fixture loader fired). Kept short
  // on purpose so a Chromium minor-version bump that re-arranges role
  // nesting still passes — the canary watches for symptom-level
  // regressions, not pixel diffs.
  requiredA11yPhrases: [
    'Paired-delta dot plot',
    'Persona cards',
    'mean Δ will-to-buy',
    'test-fixture',
  ],
  maxBannerSelectorsMatched: 0,
  maxHostCount: 5,
};

const goldResult: CaptureResult = {
  status: 'ok',
  url: 'http://127.0.0.1:3014/r/test-fixture',
  a11y_tree: [
    {
      role: 'RootWebArea',
      name: 'Simple capture fixture',
      children: [
        { role: 'heading', name: 'Pricing that scales with you', level: 1, children: [] },
        { role: 'image', name: 'Postgres logo', children: [] },
        { role: 'button', name: 'Start free', children: [] },
        { role: 'link', name: 'Talk to sales', children: [] },
      ],
    },
  ],
  banner_selectors_matched: [],
  host_count: 1,
};

describe('compareCanaryToBaseline (spec §5.16 weekly canary)', () => {
  it('returns ok=true when the fixture matches the baseline', () => {
    const verdict = compareCanaryToBaseline(goldResult, BASELINE);
    expect(verdict.ok).toBe(true);
  });

  it('fails when status is not ok (e.g. Chromium crashes)', () => {
    const broken: CaptureResult = { ...goldResult, status: 'error', breach_reason: 'wall_clock' };
    const verdict = compareCanaryToBaseline(broken, BASELINE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/status/);
    }
  });

  it('fails when an expected a11y phrase is missing (e.g. accessibility-tree regression)', () => {
    const stripped: CaptureResult = {
      ...goldResult,
      a11y_tree: [
        {
          role: 'RootWebArea',
          name: 'Simple capture fixture',
          // "Start free" button is gone — exactly the kind of regression a
          // browser bump might silently introduce by changing role mapping.
          children: [
            { role: 'heading', name: 'Pricing that scales with you', level: 1, children: [] },
            { role: 'image', name: 'Postgres logo', children: [] },
            { role: 'link', name: 'Talk to sales', children: [] },
          ],
        },
      ],
    };
    const verdict = compareCanaryToBaseline(stripped, BASELINE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/Start free/);
    }
  });

  it('fails when host_count exceeds baseline (defence-in-depth budget signal)', () => {
    const noisy: CaptureResult = { ...goldResult, host_count: 99 };
    const verdict = compareCanaryToBaseline(noisy, BASELINE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/host_count/);
    }
  });

  it('fails when a banner selector matches unexpectedly (false-positive regression)', () => {
    const banner: CaptureResult = { ...goldResult, banner_selectors_matched: ['#cookie-banner'] };
    const verdict = compareCanaryToBaseline(banner, BASELINE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/banner/);
    }
  });
});
