#!/usr/bin/env node
// Spec §5.18 performance budget — initial meaningful paint on `/r/:slug`
// at N=30 paired ≤ 1.5 s on a 5 Mbps uplink.
//
// Runner:
//   1. Boot the Next.js prod server in this worktree with the report
//      fixture seam enabled.
//   2. Drive Lighthouse against `http://localhost:3000/r/test-fixture`
//      with the desktop-fast preset throttled to 5 Mbps.
//   3. Assert FCP ≤ 1500 ms.
//
// We deliberately keep this as a standalone Node script (not a vitest
// test) because Lighthouse pulls in a chromium launch + ~80 MiB of
// transitive deps; vitest in CI shouldn't carry that. CI invokes this
// script via `pnpm --filter @willbuy/web run perf:lighthouse` once the
// browser-automation worker's CHROMIUM_PATH is published into the test
// environment.
//
// Local invocation:
//   cd apps/web
//   WILLBUY_REPORT_FIXTURE=enabled pnpm next build
//   WILLBUY_REPORT_FIXTURE=enabled pnpm next start &
//   node test/perf/lighthouse.mjs
//   kill %1
//
// Exit 0 on pass; non-zero with a JSON summary on fail.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const FIXTURE_URL = process.env.WILLBUY_PERF_URL ?? 'http://localhost:3000/r/test-fixture';
const FCP_BUDGET_MS = 1500;

const require_ = createRequire(import.meta.url);

function lazyImportLighthouse() {
  // Lighthouse + chrome-launcher are NOT pinned as workspace deps to
  // keep the install footprint small. The runner expects them to be
  // installed on the CI image (or on the dev's box) via
  // `pnpm dlx lighthouse` / `npx -y lighthouse`. If they're not
  // resolvable, exit with a clear remediation hint instead of a stack
  // trace.
  try {
    const lighthouse = require_('lighthouse');
    const chromeLauncher = require_('chrome-launcher');
    return { lighthouse, chromeLauncher };
  } catch {
    return null;
  }
}

async function main() {
  const probe = await fetch(FIXTURE_URL).catch(() => null);
  if (!probe || !probe.ok) {
    console.error(
      `[perf] fixture URL not reachable: ${FIXTURE_URL}\n` +
        '       Boot the app first:\n' +
        '         WILLBUY_REPORT_FIXTURE=enabled pnpm --filter @willbuy/web build\n' +
        '         WILLBUY_REPORT_FIXTURE=enabled pnpm --filter @willbuy/web start &',
    );
    process.exit(2);
  }

  const lh = lazyImportLighthouse();
  if (!lh) {
    console.error(
      '[perf] lighthouse / chrome-launcher not installed. Install via\n' +
        '         pnpm dlx lighthouse@12 ...\n' +
        '       or run with `npx -y lighthouse --preset=desktop --only-categories=performance ' +
        FIXTURE_URL +
        '`.',
    );
    process.exit(2);
  }

  const { lighthouse, chromeLauncher } = lh;
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--disable-gpu'],
  });
  try {
    const result = await lighthouse(FIXTURE_URL, {
      port: chrome.port,
      output: 'json',
      onlyCategories: ['performance'],
      // Spec §5.18 — 5 Mbps uplink. Lighthouse's default mobile slow-4G
      // is too pessimistic; we use desktop with custom throttling.
      formFactor: 'desktop',
      screenEmulation: { mobile: false, width: 1366, height: 900, deviceScaleFactor: 1 },
      throttling: {
        rttMs: 40,
        throughputKbps: 5_000,
        cpuSlowdownMultiplier: 1,
      },
    });
    const fcp = result.lhr.audits['first-contentful-paint'].numericValue ?? Infinity;
    const summary = {
      url: FIXTURE_URL,
      fcp_ms: Math.round(fcp),
      budget_ms: FCP_BUDGET_MS,
      pass: fcp <= FCP_BUDGET_MS,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.pass) process.exit(1);
  } finally {
    await chrome.kill();
  }
}

await main();

// Silence "unused" warnings in environments that don't have the deps;
// `spawnSync` and `existsSync` are kept around for future host-binary
// fallbacks (e.g. a system `lighthouse` CLI on the CI image).
void spawnSync;
void existsSync;
