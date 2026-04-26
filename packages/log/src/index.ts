/**
 * @willbuy/log — shared pino factory.
 *
 * Production: writes JSONL to `/var/log/willbuy/<service>.jsonl`. Pino itself
 * does not rotate; rotation is delegated to logrotate (see
 * `infra/observability/logrotate.conf`) which uses copytruncate so the open
 * file handle keeps writing into a freshly-truncated file.
 *
 * Dev: writes to stdout.
 *
 * All services apply the spec §5.12 field-level redactor from
 * `./redactor.ts`. URL hashing salt is required and read from
 * WILLBUY_LOG_HASH_SALT (caller may also pass an explicit salt). Loki
 * shipping is deferred — see issue #118 / docs/observability.md.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Writable } from 'node:stream';

import pino, { type Logger, type LoggerOptions, destination, type DestinationStream } from 'pino';

import { redact } from './redactor.js';

export { hashUrl, maskApiKey, maskEmail, redact } from './redactor.js';

export interface BuildLoggerOptions {
  service: string;
  level?: LoggerOptions['level'];
  /** SHA-256 salt for URL hashing. Required for §5.12. */
  urlHashSalt?: string;
  /** Override the default destination decision. Tests pass a Writable here. */
  destination?: Writable | DestinationStream;
  /** Override base log dir. Defaults to /var/log/willbuy. */
  logDir?: string;
}

const DEFAULT_LOG_DIR = '/var/log/willbuy';

function shouldWriteToFile(): boolean {
  if (process.env['WILLBUY_LOG_TO_FILE'] === '1') return true;
  if (process.env['WILLBUY_LOG_TO_FILE'] === '0') return false;
  return process.env['NODE_ENV'] === 'production';
}

function resolveSalt(explicit: string | undefined): string {
  if (explicit && explicit.length > 0) return explicit;
  const fromEnv = process.env['WILLBUY_LOG_HASH_SALT'];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // In dev/test we still need *some* salt; using a fixed value in non-prod
  // makes test assertions reproducible. Production callers MUST set the env.
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('@willbuy/log: WILLBUY_LOG_HASH_SALT must be set in production');
  }
  return 'willbuy-dev-salt';
}

function buildFileDestination(service: string, logDir: string): DestinationStream {
  const path = `${logDir}/${service}.jsonl`;
  // mkdir -p; OK if it already exists. Caller (or installer) usually creates
  // /var/log/willbuy with correct ownership; this is the safety net for
  // first-run on a fresh machine.
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // best effort; if we cannot mkdir, pino.destination will surface the
    // open-file error, which the supervisor will see.
  }
  return destination({
    dest: path,
    sync: false,
    mkdir: true,
    append: true,
  });
}

export function buildLogger(opts: BuildLoggerOptions): Logger {
  const salt = resolveSalt(opts.urlHashSalt);
  const formatters: NonNullable<LoggerOptions['formatters']> = {
    log(obj) {
      return redact(obj, salt) as Record<string, unknown>;
    },
  };
  const options: LoggerOptions = {
    level: opts.level ?? process.env['LOG_LEVEL'] ?? 'info',
    base: { service: opts.service },
    formatters,
  };

  if (opts.destination) {
    return pino(options, opts.destination as DestinationStream);
  }
  if (shouldWriteToFile()) {
    const logDir = opts.logDir ?? DEFAULT_LOG_DIR;
    return pino(options, buildFileDestination(opts.service, logDir));
  }
  return pino(options);
}
