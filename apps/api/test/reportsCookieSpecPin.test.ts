/**
 * reportsCookieSpecPin.test.ts — source-text pins for the share-token
 * cookie in apps/api/src/routes/reports.ts (spec §2 #20, §5.12).
 *
 * Two inline constants in reports.ts are load-bearing for the cookie-swap flow:
 *
 *   'wb_rt_' prefix — Sprint 3 retro F1: cookie name is `wb_rt_<slug>`.
 *     Changing the prefix invalidates all existing report-access cookies; users
 *     with valid ?t= URLs would re-authenticate successfully, but any browser
 *     tab that already has the old cookie would be denied (404) until it
 *     re-presents the ?t= URL.
 *
 *   MAX_COOKIE_SECONDS = 2 * 60 * 60 (7200) — spec §2 #20 "2-hour session TTL".
 *     The browser cookie TTL is capped at this value even if the underlying
 *     share-token has 90 days remaining (two-tier TTL per Sprint 3 retro F2).
 *     Lowering it causes legitimate report access to expire sooner;
 *     raising it widens the blast radius of a stolen browser profile.
 *
 * The existing reports.cookie.test.ts covers both values behaviorally via a
 * Docker-gated integration test. This file pins them at the source level so
 * a rename fails CI even without Docker.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'routes', 'reports.ts'), 'utf8');

describe("reports.ts cookie spec-pins (spec §2 #20, §5.12)", () => {
  it("cookie name follows 'wb_rt_<slug>' pattern (Sprint 3 retro F1)", () => {
    // The name is constructed as a template literal `wb_rt_${slug}`.
    expect(src).toContain('`wb_rt_${slug}`');
  });

  it("MAX_COOKIE_SECONDS is 2 * 60 * 60 = 7200 (spec §2 #20 — 2-hour TTL)", () => {
    expect(src).toContain('MAX_COOKIE_SECONDS = 2 * 60 * 60');
  });

  it("wb_rt_<slug> template literal is used twice (one per access path)", () => {
    // Path 1: token → Set-Cookie; Path 2: cookie re-read + verify.
    const count = (src.match(/`wb_rt_\$\{slug\}`/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("MAX_COOKIE_SECONDS appears in a Math.min() call capping the cookie age", () => {
    expect(src).toContain('Math.min(tokenSecondsRemaining, MAX_COOKIE_SECONDS)');
  });
});
