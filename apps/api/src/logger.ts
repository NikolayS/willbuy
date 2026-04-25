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

// Fix 1: removed unreachable `typeof key !== 'string'` branch — the only call
// site already guards with `typeof v === 'string'` before invoking maskApiKey.
function maskApiKey(key: string): string {
  const last4 = key.slice(-4);
  return `***${last4}`;
}

// Returns true when `value` is a complete URL string (not a substring within
// a longer sentence). Used by Fix 3 to hash bare-URL values regardless of
// field name.
const BARE_URL_RE = /^https?:\/\/\S+$/;
function isBareUrl(value: unknown): value is string {
  return typeof value === 'string' && BARE_URL_RE.test(value);
}

// Recursively rewrite a log payload per the spec §5.12 redaction policy.
// We do this in a custom serializer (not pino's `redact` paths) because the
// spec requires field-name based stripping at any nesting depth, including
// inside arbitrary user-supplied context objects.
//
// Fix 2: `ancestry` tracks only the current call stack (depth-first path),
// not every object ever visited. When we leave a node we remove it from the
// set (backtracking), so a DAG node reachable via two paths is NOT falsely
// reported as [Circular] — only a node that is an ancestor of itself is.
function redact(value: unknown, salt: string, ancestry = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (ancestry.has(value as object)) return '[Circular]';
  ancestry.add(value as object);
  try {
    if (Array.isArray(value)) {
      return value.map((v) => redact(v, salt, ancestry));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REMOVE_FIELDS.has(k)) continue;
      if (k === API_KEY_FIELD && typeof v === 'string') {
        out[k] = maskApiKey(v);
        continue;
      }
      // Fix 3: hash any field whose entire value is a bare URL (https?://…),
      // not just the literal field name "url". Emit <fieldName>_hash so the
      // original key is replaced and the raw URL never reaches the log line.
      if (isBareUrl(v)) {
        out[`${k}_hash`] = hashUrl(salt, v);
        continue;
      }
      out[k] = redact(v, salt, ancestry);
    }
    return out;
  } finally {
    ancestry.delete(value as object); // backtrack: remove when leaving this node
  }
}

export interface BuildLoggerOptions {
  level: LoggerOptions['level'];
  urlHashSalt: string;
}

export function buildLogger(opts: BuildLoggerOptions, dest?: Writable): Logger {
  const formatters: NonNullable<LoggerOptions['formatters']> = {
    log(obj) {
      return redact(obj, opts.urlHashSalt) as Record<string, unknown>;
    },
  };
  const options: LoggerOptions = {
    level: opts.level ?? 'info',
    formatters,
  };
  return dest ? pino(options, dest) : pino(options);
}
