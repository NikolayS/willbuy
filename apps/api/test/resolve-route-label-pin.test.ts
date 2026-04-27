/**
 * resolve-route-label-pin.test.ts — unit tests for resolveRouteLabel()
 * (issue #119 bounded-cardinality requirement).
 *
 * resolveRouteLabel() picks the Fastify route template (not the raw URL)
 * to prevent cardinality explosion from unique URLs. For unmatched 404
 * paths it returns "__unmatched__" so the histogram label stays bounded.
 */

import { describe, it, expect } from 'vitest';
import { __test__ } from '../src/routes/metrics.js';
import type { FastifyRequest } from 'fastify';

const { resolveRouteLabel } = __test__;

function fakeReq(opts: {
  routeOptionsUrl?: string;
  routerPath?: string;
  url?: string;
}): FastifyRequest {
  return {
    routeOptions: opts.routeOptionsUrl !== undefined
      ? { url: opts.routeOptionsUrl }
      : undefined,
    routerPath: opts.routerPath,
    url: opts.url ?? '/some/path',
  } as unknown as FastifyRequest;
}

describe('resolveRouteLabel() — issue #119 bounded cardinality', () => {
  it('returns routeOptions.url when present (Fastify v5 path)', () => {
    const req = fakeReq({ routeOptionsUrl: '/api/studies/:id' });
    expect(resolveRouteLabel(req)).toBe('/api/studies/:id');
  });

  it('falls back to routerPath when routeOptions.url is absent (Fastify v4 compat)', () => {
    const req = fakeReq({ routerPath: '/r/:slug' });
    expect(resolveRouteLabel(req)).toBe('/r/:slug');
  });

  it('returns "__unmatched__" when neither routeOptions.url nor routerPath is present', () => {
    const req = fakeReq({ url: '/unknown/path/xyz' });
    expect(resolveRouteLabel(req)).toBe('__unmatched__');
  });

  it('returns "__unmatched__" when routeOptions.url is an empty string', () => {
    const req = fakeReq({ routeOptionsUrl: '' });
    expect(resolveRouteLabel(req)).toBe('__unmatched__');
  });

  it('prefers routeOptions.url over routerPath when both are set', () => {
    const req = {
      routeOptions: { url: '/v5-path/:id' },
      routerPath: '/v4-path/:id',
    } as unknown as FastifyRequest;
    expect(resolveRouteLabel(req)).toBe('/v5-path/:id');
  });
});
