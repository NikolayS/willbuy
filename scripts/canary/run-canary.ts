#!/usr/bin/env bun
// run-canary.ts — Bun-executed canary runner invoked by
// scripts/canary/staging-browser-canary.sh (issue #124, spec §2 #4 + §5.16).
//
// Drives a real Playwright capture against WILLBUY_CANARY_BASE_URL plus
// the fixture path, runs compareCanaryToBaseline, prints a single-line
// JSON verdict, and exits 0 (ok) or 1 (fail). Kept thin on purpose —
// the assertion logic lives in apps/capture-worker/src/canary.ts and is
// unit-tested without a browser.

import { captureUrl } from '../../apps/capture-worker/src/capture.js';
import {
  compareCanaryToBaseline,
  type CanaryBaseline,
} from '../../apps/capture-worker/src/canary.js';

const BASE_URL = process.env.WILLBUY_CANARY_BASE_URL ?? 'http://127.0.0.1:3014';
const FIXTURE_PATH = process.env.WILLBUY_CANARY_FIXTURE_PATH ?? '/r/test-fixture';

// Same baseline the unit test pins. Substring-only on purpose so a
// Chromium minor bump that re-arranges role nesting still passes — the
// canary watches for symptom-level regressions, not pixel diffs.
const BASELINE: CanaryBaseline = {
  expectedStatus: 'ok',
  requiredA11yPhrases: [
    'Pricing that scales with you',
    'Postgres logo',
    'Start free',
    'Talk to sales',
  ],
  maxBannerSelectorsMatched: 0,
  maxHostCount: 5,
};

async function main(): Promise<number> {
  const target = `${BASE_URL.replace(/\/$/, '')}${FIXTURE_PATH}`;
  const startedAt = new Date().toISOString();
  let result;
  try {
    result = await captureUrl(target);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify({ ok: false, reason: `capture threw: ${reason}`, target, started_at: startedAt }) + '\n',
    );
    return 1;
  }

  const verdict = compareCanaryToBaseline(result, BASELINE);
  const finishedAt = new Date().toISOString();
  process.stdout.write(
    JSON.stringify({
      ok: verdict.ok,
      reason: verdict.ok ? null : verdict.reason,
      target,
      status: result.status,
      host_count: result.host_count,
      banner_selectors_matched: result.banner_selectors_matched,
      started_at: startedAt,
      finished_at: finishedAt,
    }) + '\n',
  );
  return verdict.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`run-canary: unexpected error: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(2);
  },
);
