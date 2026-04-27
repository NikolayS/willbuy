/**
 * networkidleWaitPin.test.ts — spec-pin for the Playwright page.goto()
 * waitUntil strategy in apps/capture-worker/src/capture.ts (spec §2 #2).
 *
 * The capture uses: page.goto(url, { waitUntil: 'networkidle', timeout: wallClockMs })
 *
 * 'networkidle' waits until there are no more than 0 network connections
 * for at least 500 ms — ensuring dynamic content loaded by XHR/fetch is
 * included in the a11y tree snapshot.
 *
 * Changing to 'load' or 'domcontentloaded' would capture the page before
 * dynamic content renders, producing incomplete a11y trees and missing
 * SaaS UI elements that mount after the initial page load. This would
 * silently degrade the quality of visitor LLM responses.
 *
 * The `timeout: wallClockMs` binding ensures the Playwright navigation
 * timeout aligns with the CAPTURE_CEILINGS.WALL_CLOCK_MS ceiling.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'capture.ts'), 'utf8');

describe("capture.ts Playwright page.goto() wait strategy (spec §2 #2)", () => {
  it("uses waitUntil: 'networkidle' (not 'load' or 'domcontentloaded')", () => {
    expect(src).toContain("waitUntil: 'networkidle'");
  });

  it("does not use 'load' as the waitUntil value", () => {
    expect(src).not.toContain("waitUntil: 'load'");
  });

  it("timeout is bound to wallClockMs (aligns with WALL_CLOCK_MS ceiling)", () => {
    expect(src).toContain("timeout: wallClockMs");
  });

  it("'networkidle' and 'timeout: wallClockMs' appear together in the goto() call", () => {
    const networkIdx = src.indexOf("waitUntil: 'networkidle'");
    const timeoutIdx = src.indexOf("timeout: wallClockMs");
    expect(networkIdx).toBeGreaterThan(-1);
    expect(timeoutIdx).toBeGreaterThan(-1);
    // Both appear in the same goto() call — within 200 chars of each other.
    expect(Math.abs(networkIdx - timeoutIdx)).toBeLessThan(200);
  });
});
