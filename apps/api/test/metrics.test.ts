/**
 * metrics.test.ts — TDD RED for issue #119 (`/metrics` Prometheus endpoint).
 *
 * Spec refs: §5.12 (metrics emission), §5.14 (global backpressure metrics).
 *
 * Acceptance contract (from issue #119 brief, apps/api slice):
 *   (a) GET /metrics without bearer → 401, never 200.
 *   (b) GET /metrics with valid bearer → 200, content-type
 *       text/plain; version=0.0.4 (Prometheus exposition).
 *   (c) willbuy_studies_started_total{kind} increments after a recorded
 *       study-start event.
 *   (d) willbuy_http_request_duration_seconds_bucket is emitted for at
 *       least one route after a request was served.
 *   (e) The `route` label on the request-duration histogram is the
 *       parameterized template ("/r/:slug"), not the literal URL ("/r/abc").
 *   (f) Constant-time bearer compare — wrong-length tokens also 401.
 *
 * Test strategy:
 *   - No Postgres needed for this suite. We build the Fastify app with
 *     stub-friendly env, issue requests via app.inject(), and inspect the
 *     /metrics exposition output. The `recordStudyStarted` helper exported
 *     from src/metrics is invoked directly to simulate the study-create
 *     hook firing without going through the DB-bound POST /studies path
 *     (which is covered by studies.api.test.ts).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import { recordStudyStarted, resetMetricsForTesting } from '../src/metrics/registry.js';

const METRICS_TOKEN = 'test-metrics-bearer-token-1234567890';

const BASE_ENV = {
  PORT: 0,
  LOG_LEVEL: 'silent' as const,
  URL_HASH_SALT: 'x'.repeat(32),
  DATABASE_URL: 'postgres://localhost/willbuy_metrics_test_unused',
  DAILY_CAP_CENTS: 10_000,
  STRIPE_SECRET_KEY: 'sk_test_unused',
  STRIPE_WEBHOOK_SECRET: 'whsec_unused',
  STRIPE_PRICE_ID_STARTER: 'price_unused',
  STRIPE_PRICE_ID_GROWTH: 'price_unused',
  STRIPE_PRICE_ID_SCALE: 'price_unused',
  SHARE_TOKEN_HMAC_KEY: 'dev-only-share-token-hmac-key-not-for-production-use',
  RESEND_API_KEY: 're_unused',
  RESEND_TEST_MODE: 'stub' as const,
  NODE_ENV: 'test' as const,
  WILLBUY_METRICS_TOKEN: METRICS_TOKEN,
};

describe('GET /metrics — auth gating (issue #119)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetMetricsForTesting();
    app = await buildServer({ env: BASE_ENV });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(401);
    // No metrics body should leak in the 401 response.
    expect(res.body).not.toContain('willbuy_');
  });

  it('returns 401 with a wrong bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer wrong-token-value' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with a malformed Authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: METRICS_TOKEN }, // no "Bearer " prefix
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with the correct bearer token and Prometheus content-type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    // §5.14 + Prometheus exposition format 0.0.4 (text/plain charset utf-8).
    expect(res.headers['content-type']).toMatch(/^text\/plain;\s*version=0\.0\.4/);
    // Body is non-empty and contains at least one HELP line.
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body).toMatch(/^# HELP /m);
    expect(res.body).toMatch(/^# TYPE /m);
  });
});

describe('willbuy_studies_started_total counter (issue #119 acceptance c)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetMetricsForTesting();
    app = await buildServer({ env: BASE_ENV });
  });

  afterAll(async () => {
    await app.close();
  });

  async function scrapeMetrics(): Promise<string> {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('exposes the metric with HELP/TYPE lines even at zero', async () => {
    const body = await scrapeMetrics();
    expect(body).toMatch(/^# TYPE willbuy_studies_started_total counter$/m);
    expect(body).toMatch(/^# HELP willbuy_studies_started_total /m);
  });

  it('increments after recordStudyStarted({kind:"single"}) is called', async () => {
    // Read current value (should be 0 or absent).
    const before = await scrapeMetrics();
    const beforeMatch = before.match(/^willbuy_studies_started_total\{[^}]*kind="single"[^}]*\}\s+(\d+)/m);
    const beforeVal = beforeMatch ? Number(beforeMatch[1]) : 0;

    recordStudyStarted({ kind: 'single' });
    recordStudyStarted({ kind: 'single' });
    recordStudyStarted({ kind: 'paired' });

    const after = await scrapeMetrics();
    const afterSingle = after.match(/^willbuy_studies_started_total\{[^}]*kind="single"[^}]*\}\s+(\d+)/m);
    const afterPaired = after.match(/^willbuy_studies_started_total\{[^}]*kind="paired"[^}]*\}\s+(\d+)/m);
    expect(afterSingle).not.toBeNull();
    expect(afterPaired).not.toBeNull();
    expect(Number(afterSingle![1])).toBe(beforeVal + 2);
    expect(Number(afterPaired![1])).toBe(1);
  });
});

describe('willbuy_http_request_duration_seconds histogram (issue #119 acceptance d, e)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetMetricsForTesting();
    app = await buildServer({ env: BASE_ENV });
  });

  afterAll(async () => {
    await app.close();
  });

  async function scrapeMetrics(): Promise<string> {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('emits at least one _bucket line after a request is served', async () => {
    // Hit /health to generate a measurable request without DB requirements.
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);

    const body = await scrapeMetrics();
    expect(body).toMatch(/^# TYPE willbuy_http_request_duration_seconds histogram$/m);
    expect(body).toMatch(/^willbuy_http_request_duration_seconds_bucket\{[^}]*\}\s+\d+/m);
    expect(body).toMatch(/^willbuy_http_request_duration_seconds_count\{[^}]*\}\s+\d+/m);
  });

  it('uses the parameterized route template (not the literal URL) in the route label', async () => {
    // Hit a parameterized route. /r/:slug exists in routes/reports.ts; an
    // unknown slug returns 404 but the route template is still :slug.
    // Use a literal slug that would NEVER appear as a real registered path.
    const literalSlug = 'metrics-route-label-fixture-abc';
    const r = await app.inject({ method: 'GET', url: `/r/${literalSlug}` });
    // Status doesn't matter for this assertion — we care about the route
    // label being captured against the template.
    expect([200, 302, 404]).toContain(r.statusCode);

    const body = await scrapeMetrics();

    // The literal slug must NOT appear in any `route="..."` label value.
    const routeLabels = Array.from(body.matchAll(/route="([^"]+)"/g)).map((m) => m[1]);
    for (const route of routeLabels) {
      expect(route).not.toContain(literalSlug);
    }

    // At least one route label must be the template form.
    const hasTemplate = routeLabels.some(
      (r) => r === '/r/:slug' || r === '/r/:slug/' || r?.includes(':'),
    );
    expect(hasTemplate).toBe(true);
  });

  it('does not emit an unbounded list of labels for unmatched 404 paths', async () => {
    // Issue 5 requests to distinct unknown paths. A naive implementation that
    // labels by raw URL would create 5 distinct route series; the bounded
    // implementation collapses them into a single sentinel ("__unmatched__"
    // or similar) — assert at most one route series for these.
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'GET', url: `/no-such-path-${i}-${Date.now()}` });
    }

    const body = await scrapeMetrics();
    const routeLabels = new Set(
      Array.from(body.matchAll(/route="([^"]+)"/g)).map((m) => m[1]),
    );
    // None of the literal made-up paths should appear as labels.
    for (const r of routeLabels) {
      expect(r).not.toMatch(/no-such-path-\d/);
    }
  });
});
