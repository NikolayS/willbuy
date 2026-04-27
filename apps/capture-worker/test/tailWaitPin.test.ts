/**
 * tailWaitPin.test.ts — spec-pin for the post-navigation tail-wait constants
 * in apps/capture-worker/src/capture.ts (spec §2 #2).
 *
 * After page.goto() resolves 'networkidle', the capture waits an additional
 * up to 2 seconds for late-loading content (§2 #2):
 *
 *   const tail = Math.min(2_000, Math.max(0, wallClockMs - 1_000));
 *   if (tail > 0) await page.waitForTimeout(tail);
 *
 * Two inline constants:
 *   2_000 — the maximum tail wait in ms (§2 #2 "+ 2 seconds").
 *            Lowering misses JS-rendered content; raising delays all captures.
 *
 *   1_000 — the safety reserve subtracted from wallClockMs before capping.
 *            Ensures at least 1 s remains after the tail wait for CDP tree
 *            extraction. Removing it could cause the tail wait to consume
 *            the entire wall-clock budget, leaving no time for the a11y tree.
 *
 * The ARIA role filter also excludes invisible nodes:
 *   role === 'none' || role === 'presentation'
 *   These mark layout/presentational elements that contribute no semantic
 *   value to the LLM visitor's a11y tree reasoning.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'capture.ts'), 'utf8');

describe("capture.ts tail-wait and role-filter constants (spec §2 #2)", () => {
  it("tail-wait cap is 2_000 ms (§2 #2 '+2 seconds for late-loading content')", () => {
    expect(src).toContain("Math.min(2_000,");
  });

  it("safety reserve is 1_000 ms subtracted from wallClockMs", () => {
    expect(src).toContain("wallClockMs - 1_000");
  });

  it("'none' ARIA role is filtered out of the a11y tree", () => {
    expect(src).toContain("role === 'none'");
  });

  it("'presentation' ARIA role is filtered out of the a11y tree", () => {
    expect(src).toContain("role === 'presentation'");
  });
});
