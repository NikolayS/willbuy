// canary.ts — assertion-logic for the weekly browser-stack patch SLO
// canary (spec §2 #4 + §5.16). The Bash entry-point at
// scripts/canary/staging-browser-canary.sh drives a real Playwright
// browser against a known-good fixture URL; this helper turns the
// resulting CaptureResult into a 0/1 verdict against a small, stable
// baseline. The assertions here are deliberately structural — substring
// presence in the a11y tree, status, host_count budget — so a Chromium
// minor-version bump that re-arranges role nesting still passes. The
// canary watches for symptom-level regressions (status crash, missing
// elements, accidental banner-selector hit), not pixel diffs.

import type { CaptureResult, CaptureStatus } from './types.js';

export type CanaryBaseline = {
  expectedStatus: CaptureStatus;
  /**
   * Substrings the JSON-stringified a11y tree must contain. Each entry
   * is checked with String#includes; missing any one fails the canary
   * with that phrase named in the reason so the on-call sees what
   * regressed without grepping logs.
   */
  requiredA11yPhrases: string[];
  /**
   * Maximum allowed `banner_selectors_matched.length`. The known-good
   * fixture has no cookie banner; a non-zero match means the curated
   * selector list (§2 #28) gained a false-positive against a clean DOM.
   */
  maxBannerSelectorsMatched: number;
  /**
   * Maximum allowed distinct egress hosts (§2 #5 budget is 50; canary
   * caps tighter — the fixture is local-only, so >5 implies a
   * regression in the network-namespace egress policy or a Playwright
   * default that started phoning home).
   */
  maxHostCount: number;
};

export type CanaryVerdict =
  | { ok: true }
  | { ok: false; reason: string };

export function compareCanaryToBaseline(
  actual: CaptureResult,
  baseline: CanaryBaseline,
): CanaryVerdict {
  if (actual.status !== baseline.expectedStatus) {
    const breach = actual.breach_reason ? ` breach=${actual.breach_reason}` : '';
    return {
      ok: false,
      reason: `status mismatch: expected=${baseline.expectedStatus} actual=${actual.status}${breach}`,
    };
  }

  if (actual.banner_selectors_matched.length > baseline.maxBannerSelectorsMatched) {
    return {
      ok: false,
      reason: `banner selectors matched unexpectedly: ${actual.banner_selectors_matched.join(', ')}`,
    };
  }

  if (actual.host_count > baseline.maxHostCount) {
    return {
      ok: false,
      reason: `host_count too high: ${actual.host_count} > ${baseline.maxHostCount}`,
    };
  }

  const flat = JSON.stringify(actual.a11y_tree);
  for (const phrase of baseline.requiredA11yPhrases) {
    if (!flat.includes(phrase)) {
      return {
        ok: false,
        reason: `required a11y phrase missing: ${JSON.stringify(phrase)}`,
      };
    }
  }

  return { ok: true };
}
