/**
 * domain-reports-studies-pin.test.ts — spec-pins for domain verification,
 * report cookie, and study pricing constants.
 *
 * PROBE_TIMEOUT_MS=5000, TOKEN_LENGTH=22 (domains.ts):
 *   Lowering PROBE_TIMEOUT_MS causes spurious probe failures on slow DNS.
 *   TOKEN_LENGTH=22 gives 22×log2(62) ≈ 131 bits of entropy for the
 *   verification token — halving it would drop below the 64-bit floor.
 *
 * MAX_COOKIE_SECONDS=7200 (reports.ts):
 *   Report share-token cookies have a 2-hour TTL per spec §2 #20 (Sprint 3
 *   retro finding F2). Shortening it silently breaks sessions for users on
 *   long reads; lengthening it violates the spec maximum.
 *
 * CENTS_PER_VISIT_EST=5, CENTS_PER_STUDY_CLUSTER_LABEL=3 (studies.ts):
 *   These drive the cost estimate shown at study-creation time (spec §5.5).
 *   Changing them without a billing-model review silently misquotes prices
 *   to paying customers.
 */

import { describe, expect, it } from 'vitest';
import { __test__ as domainsTest } from '../src/routes/domains.js';
import { __test__ as reportsTest } from '../src/routes/reports.js';
import { __test__ as studiesTest } from '../src/routes/studies.js';

const { PROBE_TIMEOUT_MS, TOKEN_LENGTH } = domainsTest;
const { MAX_COOKIE_SECONDS } = reportsTest;
const { CENTS_PER_VISIT_EST, CENTS_PER_STUDY_CLUSTER_LABEL } = studiesTest;

describe('Domain verification constants spec-pin (domains.ts)', () => {
  it('PROBE_TIMEOUT_MS is 5000 ms (5 seconds)', () => {
    expect(PROBE_TIMEOUT_MS).toBe(5_000);
  });

  it('TOKEN_LENGTH is 22 (≈131 bits of entropy in base62)', () => {
    expect(TOKEN_LENGTH).toBe(22);
  });
});

describe('Report cookie constant spec-pin (reports.ts)', () => {
  it('MAX_COOKIE_SECONDS is 7200 (2 hours per spec §2 #20)', () => {
    expect(MAX_COOKIE_SECONDS).toBe(7_200);
    expect(MAX_COOKIE_SECONDS).toBe(2 * 60 * 60);
  });
});

describe('Study pricing constants spec-pin (studies.ts)', () => {
  it('CENTS_PER_VISIT_EST is 5 (5¢ per visit per spec §5.5)', () => {
    expect(CENTS_PER_VISIT_EST).toBe(5);
  });

  it('CENTS_PER_STUDY_CLUSTER_LABEL is 3 (3¢ once-per-study)', () => {
    expect(CENTS_PER_STUDY_CLUSTER_LABEL).toBe(3);
  });
});
