import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sensible from '@fastify/sensible';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import type { Env } from './env.js';
import { buildLogger } from './logger.js';

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

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    version: pkgVersion,
  }));

  return app;
}
