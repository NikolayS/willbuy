/**
 * routes/metrics.ts — GET /metrics (issue #119, spec §5.14).
 *
 * Auth: required Authorization: Bearer <WILLBUY_METRICS_TOKEN>. Constant-time
 * compare. If WILLBUY_METRICS_TOKEN is unset, the endpoint is locked down —
 * every request returns 401. We never silently expose metrics.
 *
 * The HTTP request-duration histogram is wired via Fastify's onResponse hook
 * (registered alongside the route). The `route` label is the parameterized
 * template (e.g. "/r/:slug"); for unmatched 404 paths we emit
 * `route="__unmatched__"` so cardinality stays bounded regardless of the
 * volume of unknown URLs hitting the API.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  PROMETHEUS_CONTENT_TYPE,
  constantTimeEquals,
  recordHttpRequest,
  renderExposition,
} from '../metrics/registry.js';

interface StartTime {
  startNs: bigint;
}

declare module 'fastify' {
  interface FastifyRequest {
    _willbuyMetricsStart?: StartTime;
  }
}

/**
 * Resolve the bounded route label for a Fastify request. Prefers the
 * route template captured by Fastify; falls back to "__unmatched__" for
 * unmatched paths so 404s don't blow up label cardinality.
 */
function resolveRouteLabel(req: FastifyRequest): string {
  // Fastify v5 exposes `req.routeOptions.url` on matched routes; falls back to
  // request.url for unmatched. We never label by raw URL (issue #119
  // bounded-cardinality requirement).
  const routeOptions = (req as unknown as { routeOptions?: { url?: string } }).routeOptions;
  if (routeOptions && typeof routeOptions.url === 'string' && routeOptions.url.length > 0) {
    return routeOptions.url;
  }
  // Fastify v4 compat (older field name).
  const routerPath = (req as unknown as { routerPath?: string }).routerPath;
  if (typeof routerPath === 'string' && routerPath.length > 0) {
    return routerPath;
  }
  return '__unmatched__';
}

export async function registerMetricsRoute(
  app: FastifyInstance,
  metricsToken: string | undefined,
): Promise<void> {
  // Capture per-request start time for the duration histogram. onRequest fires
  // before route handling; onResponse fires after the reply has been sent.
  app.addHook('onRequest', async (req) => {
    req._willbuyMetricsStart = { startNs: process.hrtime.bigint() };
  });

  app.addHook('onResponse', async (req, reply) => {
    if (!req._willbuyMetricsStart) return;
    // Don't double-count /metrics itself — the scrape would dominate the
    // histogram on quiet hosts and obscure real traffic.
    const routeLabel = resolveRouteLabel(req);
    if (routeLabel === '/metrics') return;

    const durationNs = process.hrtime.bigint() - req._willbuyMetricsStart.startNs;
    const durationSeconds = Number(durationNs) / 1e9;
    recordHttpRequest({
      route: routeLabel,
      method: req.method,
      status: reply.statusCode,
      durationSeconds,
    });
  });

  app.get('/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    // Locked when token is unset — never leak metrics on misconfigured boxes.
    if (!metricsToken) {
      return reply.code(401).header('content-type', 'text/plain').send('unauthorized\n');
    }

    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      return reply.code(401).header('content-type', 'text/plain').send('unauthorized\n');
    }
    const presented = auth.slice('Bearer '.length);
    if (!constantTimeEquals(presented, metricsToken)) {
      return reply.code(401).header('content-type', 'text/plain').send('unauthorized\n');
    }

    const body = renderExposition();
    return reply
      .code(200)
      .header('content-type', PROMETHEUS_CONTENT_TYPE)
      .header('cache-control', 'no-store')
      .send(body);
  });
}

// Test seam — not part of the public API surface.
export const __test__ = { resolveRouteLabel };
