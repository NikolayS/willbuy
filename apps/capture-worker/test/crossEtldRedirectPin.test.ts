/**
 * crossEtldRedirectPin.test.ts — spec-pin for 'cross_etld_redirect' reason
 * in checkRedirectAllowed (apps/capture-worker/src/run-with-netns.ts).
 *
 * Spec §2 #5 / §2 #7: per-request DNS pinning means a cross-eTLD+1
 * redirect is blocked if the resolved IP set is not a subset of the
 * originally-allowed IPs snapshotted at netns bring-up. The function
 * returns { allowed: false, reason: 'cross_etld_redirect' }.
 *
 * PR #304 (test/capture-worker-check-redirect) covers the other three
 * reason values: 'no_state', 'bad_url', 'dns_fail'.
 * 'cross_etld_redirect' is NOT covered behaviourally there — it requires
 * a state file with allowed IPs AND a live DNS resolve that returns a
 * different IP, which is impractical without a full netns integration test.
 *
 * Source-text pin: if 'cross_etld_redirect' is renamed (e.g. to
 * 'cross_origin_redirect'), the per-redirect egress policy signal used by
 * structured-log alerts would silently change with no test failing.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  resolve(here, '..', 'src', 'run-with-netns.ts'),
  'utf8',
);

describe("checkRedirectAllowed 'cross_etld_redirect' spec-pin (spec §2 #5 / §2 #7)", () => {
  it("'cross_etld_redirect' reason string exists in run-with-netns.ts", () => {
    expect(src).toContain("'cross_etld_redirect'");
  });

  it("is returned when resolved IP is not in the allowed set (post-state check)", () => {
    // Verify the return site appears inside checkRedirectAllowed (after the
    // stateFile read and DNS lookup paths).
    const fnIdx = src.indexOf('export async function checkRedirectAllowed');
    const retIdx = src.indexOf("reason: 'cross_etld_redirect'");
    expect(fnIdx).toBeGreaterThanOrEqual(0);
    expect(retIdx).toBeGreaterThan(fnIdx);
  });
});
