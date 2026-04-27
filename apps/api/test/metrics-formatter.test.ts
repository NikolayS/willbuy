/**
 * metrics-formatter.test.ts — unit tests for the Prometheus exposition
 * formatter helpers in metrics/registry.ts (issue #119).
 *
 * Tests target: formatNumber, escapeLabelValue, renderLabels, cumulative
 * histogram bucket semantics. These helpers are not exported directly but
 * are fully observable via renderExposition() after calling the public
 * recording functions.
 *
 * No server build, no Docker, no DB needed — pure in-process state tests.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  recordHttpRequest,
  recordStudyStarted,
  renderExposition,
  resetMetricsForTesting,
} from '../src/metrics/registry.js';

afterEach(() => {
  resetMetricsForTesting();
});

// ── formatNumber — observable via le= labels and _sum lines ─────────────────

describe('formatNumber — integer bucket bounds use integer format', () => {
  it('emits le="1" not le="1.000000" for the 1s bucket bound', () => {
    recordHttpRequest({ route: '/health', method: 'GET', status: 200, durationSeconds: 0.001 });
    const body = renderExposition();
    expect(body).toContain('le="1"');
  });

  it('emits le="5" and le="10" and le="30" as integers', () => {
    recordHttpRequest({ route: '/health', method: 'GET', status: 200, durationSeconds: 0.001 });
    const body = renderExposition();
    expect(body).toContain('le="5"');
    expect(body).toContain('le="10"');
    expect(body).toContain('le="30"');
  });

  it('emits le="2.5" (non-integer) with minimal decimals', () => {
    recordHttpRequest({ route: '/health', method: 'GET', status: 200, durationSeconds: 0.001 });
    const body = renderExposition();
    expect(body).toContain('le="2.5"');
    expect(body).not.toContain('le="2.500000"');
  });
});

describe('formatNumber — _sum line uses minimal format', () => {
  it('_sum is integer string when observation is a whole number', () => {
    recordHttpRequest({ route: '/api/test', method: 'GET', status: 200, durationSeconds: 2 });
    const body = renderExposition();
    // _sum line must contain " 2" not " 2.000000"
    const sumLine = body.split('\n').find((l) => l.includes('_sum') && l.includes('/api/test'));
    expect(sumLine).toBeDefined();
    expect(sumLine).toMatch(/ 2$/);
  });

  it('_sum is minimal float for fractional observations', () => {
    recordHttpRequest({ route: '/api/test', method: 'GET', status: 200, durationSeconds: 0.5 });
    const body = renderExposition();
    const sumLine = body.split('\n').find((l) => l.includes('_sum') && l.includes('/api/test'));
    expect(sumLine).toBeDefined();
    expect(sumLine).toMatch(/ 0\.5$/);
    expect(sumLine).not.toMatch(/0\.500000/);
  });

  it('_sum accumulates multiple observations correctly', () => {
    recordHttpRequest({ route: '/api/test', method: 'GET', status: 200, durationSeconds: 1 });
    recordHttpRequest({ route: '/api/test', method: 'GET', status: 200, durationSeconds: 1 });
    recordHttpRequest({ route: '/api/test', method: 'GET', status: 200, durationSeconds: 1 });
    const body = renderExposition();
    const sumLine = body.split('\n').find((l) => l.includes('_sum') && l.includes('/api/test'));
    expect(sumLine).toMatch(/ 3$/);
  });
});

// ── escapeLabelValue — backslash, double-quote, newline escaping ─────────────

describe('escapeLabelValue — special chars in route label', () => {
  it('escapes double-quote in label value (route with quote)', () => {
    // route label with a double-quote char — must appear as \" in exposition.
    recordHttpRequest({ route: '/api/test"endpoint', method: 'GET', status: 200, durationSeconds: 0.1 });
    const body = renderExposition();
    expect(body).toContain('route="/api/test\\"endpoint"');
  });

  it('escapes backslash in label value (route with backslash)', () => {
    recordHttpRequest({ route: '/api/test\\path', method: 'GET', status: 200, durationSeconds: 0.1 });
    const body = renderExposition();
    expect(body).toContain('route="/api/test\\\\path"');
  });

  it('escapes newline in label value (route with newline)', () => {
    recordHttpRequest({ route: '/api/test\npath', method: 'GET', status: 200, durationSeconds: 0.1 });
    const body = renderExposition();
    expect(body).toContain('route="/api/test\\npath"');
  });
});

// ── renderLabels — key sort order ────────────────────────────────────────────

describe('renderLabels — label keys are sorted alphabetically', () => {
  it('histogram labels appear sorted (method, route, status — alphabetical)', () => {
    recordHttpRequest({ route: '/health', method: 'GET', status: 200, durationSeconds: 0.01 });
    const body = renderExposition();
    // The _bucket line must have keys in sorted order: method, route, status
    // (alphabetical: m < r < s).
    const bucketLine = body.split('\n').find((l) =>
      l.includes('_bucket') && l.includes('route="/health"'),
    );
    expect(bucketLine).toBeDefined();
    const labelsMatch = bucketLine!.match(/\{([^}]+)\}/);
    expect(labelsMatch).not.toBeNull();
    const keys = labelsMatch![1]!.split(',').map((p) => p.split('=')[0]);
    // le is injected last by the formatter; skip it.
    const coreKeys = keys.filter((k) => k !== 'le');
    expect(coreKeys).toEqual(['method', 'route', 'status']);
  });
});

// ── Histogram cumulative bucket semantics ────────────────────────────────────

describe('histogram cumulative bucket counts', () => {
  it('observation of 0.01s falls into le=0.01 and all larger buckets but not le=0.005', () => {
    recordHttpRequest({ route: '/ping', method: 'GET', status: 200, durationSeconds: 0.01 });
    const body = renderExposition();

    const lines = body.split('\n');
    const get = (le: string) => {
      const l = lines.find(
        (ln) =>
          ln.includes('_bucket') &&
          ln.includes('route="/ping"') &&
          ln.includes(`le="${le}"`),
      );
      if (!l) return null;
      return Number(l.split(' ').at(-1));
    };

    expect(get('0.005')).toBe(0); // 0.01 > 0.005
    expect(get('0.01')).toBe(1);  // 0.01 <= 0.01
    expect(get('0.025')).toBe(1); // 0.01 <= 0.025
    expect(get('+Inf')).toBe(1);  // always _count
  });

  it('two observations straddling a bucket bound produce correct counts', () => {
    // 0.005 falls in le≥0.005; 0.1 falls in le≥0.1; both in +Inf.
    recordHttpRequest({ route: '/ping', method: 'GET', status: 200, durationSeconds: 0.005 });
    recordHttpRequest({ route: '/ping', method: 'GET', status: 200, durationSeconds: 0.1 });
    const body = renderExposition();
    const lines = body.split('\n');
    const get = (le: string) => {
      const l = lines.find(
        (ln) =>
          ln.includes('_bucket') &&
          ln.includes('route="/ping"') &&
          ln.includes(`le="${le}"`),
      );
      return l ? Number(l.split(' ').at(-1)) : null;
    };

    expect(get('0.005')).toBe(1);  // only the 0.005 obs
    expect(get('0.01')).toBe(1);   // only the 0.005 obs (0.1 > 0.01)
    expect(get('0.1')).toBe(2);    // both (0.005 <= 0.1 AND 0.1 <= 0.1)
    expect(get('+Inf')).toBe(2);   // _count = 2
  });
});

// ── Counter label sort — studiesStarted ──────────────────────────────────────

describe('counter label sort', () => {
  it('studies_started_total emits label set without extra whitespace', () => {
    recordStudyStarted({ kind: 'paired' });
    const body = renderExposition();
    expect(body).toMatch(/willbuy_studies_started_total\{kind="paired"\} 1/);
  });
});
