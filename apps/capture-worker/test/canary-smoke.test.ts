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
  //
  // Note: "MEAN Δ WILL-TO-BUY" is uppercased here on purpose. The DOM
  // text content is lowercase ("mean Δ will-to-buy"), but the span
  // applies CSS `text-transform: uppercase` and Chromium computes the
  // accessible name from the *rendered* string. Asserting on the a11y
  // form keeps the unit-test honest with what live capture sees.
  requiredA11yPhrases: [
    'Paired-delta dot plot',
    'Persona cards',
    'MEAN Δ WILL-TO-BUY',
    'test-fixture',
  ],
  maxBannerSelectorsMatched: 0,
  maxHostCount: 5,
};

// Stub a11y tree shaped after the live /r/test-fixture render
// (apps/web/app/r/[slug]/page.tsx + ReportView): page-level h1 names the
// study slug, then the report sections expose their h2 headings and the
// headline-stat label. Only the substrings BASELINE asserts on need to
// be present; structure is illustrative.
const goldResult: CaptureResult = {
  status: 'ok',
  url: 'http://127.0.0.1:3014/r/test-fixture',
  a11y_tree: [
    {
      role: 'RootWebArea',
      name: 'willbuy.dev — public report',
      children: [
        { role: 'heading', name: 'Study test-fixture', level: 1, children: [] },
        { role: 'text', name: 'MEAN Δ WILL-TO-BUY', children: [] },
        { role: 'heading', name: 'Paired-delta dot plot', level: 2, children: [] },
        { role: 'heading', name: 'Persona cards', level: 2, children: [] },
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
          name: 'willbuy.dev — public report',
          // "Persona cards" h2 is gone — exactly the kind of regression a
          // browser bump might silently introduce by changing role mapping
          // (e.g. h2 → generic), and a real one if the component stops
          // rendering the section header at all.
          children: [
            { role: 'heading', name: 'Study test-fixture', level: 1, children: [] },
            { role: 'text', name: 'MEAN Δ WILL-TO-BUY', children: [] },
            { role: 'heading', name: 'Paired-delta dot plot', level: 2, children: [] },
          ],
        },
      ],
    };
    const verdict = compareCanaryToBaseline(stripped, BASELINE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/Persona cards/);
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
