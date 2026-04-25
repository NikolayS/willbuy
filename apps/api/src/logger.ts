import { createHash } from 'node:crypto';
import type { Writable } from 'node:stream';

import pino, { type Logger, type LoggerOptions } from 'pino';

// Spec §5.12 — fields whose VALUES must never reach a structured log line.
// `url` gets special treatment (replaced with `url_hash`); the rest are dropped.
const REMOVE_FIELDS = new Set([
  'share_token',
  'email',
  'backstory',
  'a11y_tree',
  'llm_output',
  'provider_payload',
  'password',
]);
const URL_FIELD = 'url';
const API_KEY_FIELD = 'api_key';

export function hashUrl(salt: string, url: string): string {
  return createHash('sha256')
    .update(salt + url)
    .digest('hex')
    .slice(0, 16);
}

function maskApiKey(key: string): string {
  if (typeof key !== 'string') return '***';
  const last4 = key.slice(-4);
  return `***${last4}`;
}

// Recursively rewrite a log payload per the spec §5.12 redaction policy.
// We do this in a custom serializer (not pino's `redact` paths) because the
// spec requires field-name based stripping at any nesting depth, including
// inside arbitrary user-supplied context objects.
function redact(value: unknown, salt: string, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, salt, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REMOVE_FIELDS.has(k)) continue;
    if (k === URL_FIELD && typeof v === 'string') {
      out['url_hash'] = hashUrl(salt, v);
      continue;
    }
    if (k === API_KEY_FIELD && typeof v === 'string') {
      out[k] = maskApiKey(v);
      continue;
    }
    out[k] = redact(v, salt, seen);
  }
  return out;
}

export interface BuildLoggerOptions {
  level: LoggerOptions['level'];
  urlHashSalt: string;
}

export function buildLogger(opts: BuildLoggerOptions, dest?: Writable): Logger {
  const formatters: NonNullable<LoggerOptions['formatters']> = {
    log(obj) {
      return redact(obj, opts.urlHashSalt, new WeakSet()) as Record<string, unknown>;
    },
  };
  const options: LoggerOptions = {
    level: opts.level ?? 'info',
    formatters,
  };
  return dest ? pino(options, dest) : pino(options);
}
