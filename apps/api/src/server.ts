import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sensible from '@fastify/sensible';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import type { Env } from './env.js';
import { buildLogger } from './logger.js';
import { registerStudiesRoutes } from './routes/studies.js';
import { registerReportsRoutes } from './routes/reports.js';

const here = dirname(fileURLToPath(import.meta.url));
// dist/ when built, src/ when run via tsx — both are one level below apps/api.
const pkgPath = resolve(here, '..', 'package.json');
const pkgVersion = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;

export interface BuildServerOptions {
  env: Env;
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const logger = buildLogger({
    level: opts.env.LOG_LEVEL,
    urlHashSalt: opts.env.URL_HASH_SALT,
  });

  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: opts.env.LOG_LEVEL === 'silent',
  });

  await app.register(sensible);

  // Postgres connection pool — shared across all routes.
  const pool = new Pool({ connectionString: opts.env.DATABASE_URL });

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    version: pkgVersion,
  }));

  // Wire authenticated routes.
  await registerStudiesRoutes(app, pool, opts.env);

  // Wire public report route.
  await registerReportsRoutes(app, pool);

  // Close pool on server shutdown.
  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
