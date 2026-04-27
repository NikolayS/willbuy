/**
 * metrics-histogram-buckets.test.ts — spec-pins for HTTP_DURATION_BUCKETS
 * in apps/api/src/metrics/registry.ts.
 *
 * HTTP_DURATION_BUCKETS defines the Prometheus histogram bucket upper bounds
 * for willbuy_http_request_duration_seconds. The buckets are tuned for:
 *   - Sub-100ms typical API responses
 *   - LLM-touching routes that reach up to ~30s
 *   - 30s = willbuy worst-case capture timeout
 *
 * Changing any bucket changes what percentiles are observable in Prometheus
 * and can break dashboards or alerting rules that reference specific buckets.
 * The 30s upper bound is spec-referenced (§4.1 capture timeout).
 *
 * Pins:
 *   - Count = 12 (one +Inf is added by prom-client automatically)
 *   - First bucket = 0.005s (5ms) — catches fast-path cache hits
 *   - Last explicit bucket = 30s — covers worst-case capture timeout
 *   - Contains 1s — the canonical SLO threshold for API latency
 *   - Monotonically increasing (required by Prometheus)
 */

import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/metrics/registry.js';

const { HTTP_DURATION_BUCKETS } = __test__;

describe('HTTP_DURATION_BUCKETS spec-pin (metrics/registry.ts)', () => {
  it('has exactly 12 entries', () => {
    expect(HTTP_DURATION_BUCKETS).toHaveLength(12);
  });

  it('first bucket is 0.005s (5ms)', () => {
    expect(HTTP_DURATION_BUCKETS[0]).toBe(0.005);
  });

  it('last explicit bucket is 30s (worst-case capture timeout)', () => {
    expect(HTTP_DURATION_BUCKETS[HTTP_DURATION_BUCKETS.length - 1]).toBe(30);
  });

  it('contains 1s (canonical SLO threshold)', () => {
    expect(HTTP_DURATION_BUCKETS).toContain(1);
  });

  it('contains 0.1s (100ms — typical p99 target)', () => {
    expect(HTTP_DURATION_BUCKETS).toContain(0.1);
  });

  it('is monotonically increasing (Prometheus requires this)', () => {
    for (let i = 1; i < HTTP_DURATION_BUCKETS.length; i++) {
      expect(HTTP_DURATION_BUCKETS[i]!).toBeGreaterThan(HTTP_DURATION_BUCKETS[i - 1]!);
    }
  });

  it('all values are positive (Prometheus requires positive bounds)', () => {
    for (const b of HTTP_DURATION_BUCKETS) {
      expect(b).toBeGreaterThan(0);
    }
  });
});
