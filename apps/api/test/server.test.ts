import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';

describe('GET /health (spec §4.1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({
      env: {
        PORT: 0,
        LOG_LEVEL: 'silent',
        URL_HASH_SALT: 'x'.repeat(32),
        DATABASE_URL: 'postgres://localhost/test',
        DAILY_CAP_CENTS: 10_000,
        STRIPE_SECRET_KEY: 'sk_test_not_used_in_health_test',
        STRIPE_WEBHOOK_SECRET: 'whsec_not_used_in_health_test',
        STRIPE_PRICE_ID_STARTER: 'price_not_used',
        STRIPE_PRICE_ID_GROWTH: 'price_not_used',
        STRIPE_PRICE_ID_SCALE: 'price_not_used',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 and a JSON body with status, uptime, version', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; uptime: number; version: string };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });
});
