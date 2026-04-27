/**
 * metrics-histogram-buckets.test.ts — spec-pin for HTTP_DURATION_BUCKETS.
 *
 * Spec refs: §5.12 (metrics emission), §5.14 (global backpressure metrics).
 *
 * The 12 bucket bounds [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5,
 * 5, 10, 30] encode a deliberate engineering decision: the 30s bound covers
 * the worst-case capture timeout (spec §5.13 / WALL_CLOCK_MS=45 000ms).
 * Silently dropping or shifting any bound would break Grafana alert thresholds
 * without any other test failing.
 *
 * No server needed — this exercises registry state directly.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  recordHttpRequest,
  renderExposition,
  resetMetricsForTesting,
} from '../src/metrics/registry.js';

afterEach(() => {
  resetMetricsForTesting();
});

// The expected le= values match HTTP_DURATION_BUCKETS in registry.ts plus +Inf.
const EXPECTED_LE = [
  '0.005',
  '0.01',
  '0.025',
  '0.05',
  '0.1',
  '0.25',
  '0.5',
  '1',
  '2.5',
  '5',
  '10',
  '30',
  '+Inf',
] as const;

describe('HTTP_DURATION_BUCKETS spec-pin (spec §5.12, issue #119)', () => {
  function bucketLeValues(): Set<string> {
    const body = renderExposition();
    const matches = [...body.matchAll(/willbuy_http_request_duration_seconds_bucket\{[^}]*le="([^"]+)"/g)];
    return new Set(matches.map((m) => m[1]!));
  }

  it('emits exactly the 12 finite bounds plus +Inf — no more, no less', () => {
    recordHttpRequest({ route: '/health', method: 'GET', status: 200, durationSeconds: 0.001 });
    const observed = bucketLeValues();
    const expected = new Set(EXPECTED_LE);
    expect(observed).toEqual(expected);
  });

  it('includes the 30s bound that covers the worst-case capture timeout', () => {
    recordHttpRequest({ route: '/health', method: 'GET', status: 200, durationSeconds: 0.001 });
    const observed = bucketLeValues();
    expect(observed.has('30')).toBe(true);
  });

  it('includes the 5ms sub-millisecond bound for fast in-memory routes', () => {
    recordHttpRequest({ route: '/health', method: 'GET', status: 200, durationSeconds: 0.001 });
    const observed = bucketLeValues();
    expect(observed.has('0.005')).toBe(true);
  });

  it('includes +Inf bucket (Prometheus specification requirement)', () => {
    recordHttpRequest({ route: '/health', method: 'GET', status: 200, durationSeconds: 0.001 });
    const observed = bucketLeValues();
    expect(observed.has('+Inf')).toBe(true);
  });

  it('emits exactly 13 distinct le= values (12 finite + +Inf)', () => {
    recordHttpRequest({ route: '/health', method: 'GET', status: 200, durationSeconds: 0.001 });
    const observed = bucketLeValues();
    expect(observed.size).toBe(13);
  });
});
