/**
 * apps/api/src/logger.ts — thin re-export of the shared @willbuy/log
 * factory. The redactor and pino plumbing live in packages/log per
 * issue #118 (single source of truth for spec §5.12).
 *
 * Existing api callers/tests (logger.test.ts, redact.test.ts) keep importing
 * `buildLogger` and `hashUrl` from this path; we forward the call to the
 * shared package and add the `service: 'api'` label automatically.
 */
import type { Logger, LoggerOptions } from 'pino';
import type { Writable } from 'node:stream';

import { buildLogger as sharedBuildLogger, type BuildLoggerOptions } from '@willbuy/log';

export { hashUrl, maskApiKey, maskEmail } from '@willbuy/log';

export interface ApiBuildLoggerOptions {
  level: LoggerOptions['level'];
  urlHashSalt: string;
}

/**
 * buildLogger() — kept on its existing 2-arg signature for backwards-compat
 * with the api app's tests (they pass a Writable as the second arg).
 */
export function buildLogger(opts: ApiBuildLoggerOptions, dest?: Writable): Logger {
  const sharedOpts: BuildLoggerOptions = {
    service: 'api',
    level: opts.level,
    urlHashSalt: opts.urlHashSalt,
    ...(dest ? { destination: dest } : {}),
  };
  return sharedBuildLogger(sharedOpts);
}
