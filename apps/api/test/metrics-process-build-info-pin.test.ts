/**
 * metrics-process-build-info-pin.test.ts — spec-pin for the two self-describing
 * gauges in metrics/registry.ts (spec §5.14, issue #119).
 *
 * willbuy_process_start_time_seconds — Unix timestamp of process start.
 *   Grafana derives uptime as `time() - willbuy_process_start_time_seconds`.
 *   Renaming this metric breaks the uptime panel silently.
 *
 * willbuy_build_info — always-1 gauge whose `version` label carries the
 *   apps/api package.json version. Dashboards use this for version tracking.
 *   Renaming the metric or its label breaks version overlays silently.
 *
 * Both gauges are auto-initialized at module load by initSelfDescribingMetrics()
 * so they appear immediately in renderExposition() without any explicit record
 * call from the test.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { renderExposition, resetMetricsForTesting } from '../src/metrics/registry.js';

beforeEach(() => {
  resetMetricsForTesting();
});

describe('willbuy_process_start_time_seconds gauge (spec §5.14 — uptime anchor)', () => {
  it('appears in the Prometheus exposition output', () => {
    const exp = renderExposition();
    expect(exp).toContain('willbuy_process_start_time_seconds');
  });

  it('has TYPE gauge', () => {
    const exp = renderExposition();
    expect(exp).toMatch(/^# TYPE willbuy_process_start_time_seconds gauge$/m);
  });

  it('has a plausible unix-seconds value (after 2020-01-01, before year 2286)', () => {
    const exp = renderExposition();
    // Match the bare metric line (no labels)
    const match = exp.match(/^willbuy_process_start_time_seconds\s+(\d+)/m);
    expect(match).not.toBeNull();
    const val = Number(match![1]);
    // 2020-01-01 UTC = 1_577_836_800; year 2286 ≈ 9_999_999_999
    expect(val).toBeGreaterThan(1_577_836_800);
    expect(val).toBeLessThan(9_999_999_999);
  });
});

describe('willbuy_build_info gauge (spec §5.14 — version label)', () => {
  it('appears in the Prometheus exposition output', () => {
    const exp = renderExposition();
    expect(exp).toContain('willbuy_build_info');
  });

  it('has TYPE gauge', () => {
    const exp = renderExposition();
    expect(exp).toMatch(/^# TYPE willbuy_build_info gauge$/m);
  });

  it('always has value 1 (presence indicator)', () => {
    const exp = renderExposition();
    // willbuy_build_info{version="..."} 1
    expect(exp).toMatch(/^willbuy_build_info\{[^}]*\} 1$/m);
  });

  it('carries a "version" label', () => {
    const exp = renderExposition();
    expect(exp).toMatch(/^willbuy_build_info\{[^}]*version="[^"]*"[^}]*\} 1$/m);
  });
});
