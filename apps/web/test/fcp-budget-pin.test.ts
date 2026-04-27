/**
 * fcp-budget-pin.test.ts — spec-pin for FCP_BUDGET_MS in test/perf/lighthouse.mjs.
 *
 * Spec §5.18 "performance budget": FCP on /r/:slug ≤ 1500 ms at 5 Mbps
 * (desktop-fast Lighthouse preset). This constant controls whether the CI
 * perf gate passes or fails — loosening it (e.g. to 2000) would silently
 * weaken the §5.18 requirement without any other failing test.
 *
 * We read the runner file as text and assert the numeric value, because
 * the runner is a standalone Node.js script (not a module with exports)
 * that lazily requires Lighthouse — importing it would pull in a heavy
 * optional dep and break in environments where Lighthouse is not installed.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const lighthouseScript = resolve(here, 'perf', 'lighthouse.mjs');

describe('FCP_BUDGET_MS spec-pin (spec §5.18 — FCP ≤ 1500 ms at 5 Mbps)', () => {
  it('lighthouse runner file exists at apps/web/test/perf/lighthouse.mjs', () => {
    expect(() => readFileSync(lighthouseScript, 'utf8')).not.toThrow();
  });

  it('FCP_BUDGET_MS is assigned the value 1500', () => {
    const src = readFileSync(lighthouseScript, 'utf8');
    // Match the exact assignment — guards against both "= 1501" and "= 1499"
    expect(src).toMatch(/\bFCP_BUDGET_MS\s*=\s*1500\b/);
  });

  it('FCP_BUDGET_MS appears in the pass/fail comparison', () => {
    const src = readFileSync(lighthouseScript, 'utf8');
    // The comparison `fcp <= FCP_BUDGET_MS` must be present — ensures the
    // constant is actually used in the gate, not just declared.
    expect(src).toMatch(/fcp\s*<=\s*FCP_BUDGET_MS/);
  });
});
