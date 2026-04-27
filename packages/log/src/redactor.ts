/**
 * redactor.ts — spec §5.12 field-level log redaction.
 *
 * Logs emit ONLY allowlisted fields (account_id, study_id, visit_id,
 * provider_attempt_id, transport_attempt_id, event name, duration, error
 * class). The following are NEVER emitted in any structured log line, at any
 * nesting depth, regardless of field name:
 *
 *   - raw URLs                  → hashed via salted SHA-256, key suffixed `_hash`
 *   - share-token values        → field "share_token" stripped; bare hex/b64 ≥32 char masked
 *   - API keys                  → field "api_key" masked to last 4
 *   - provider payloads         → field "provider_payload" stripped
 *   - a11y-tree content         → field "a11y_tree" stripped
 *   - LLM output strings        → field "llm_output" stripped
 *   - backstory text            → field "backstory" stripped
 *   - email addresses           → field "email" masked to `t***@d***.tld`;
 *                                 bare email values anywhere also masked
 *   - captured page bytes       → field "page_bytes" stripped;
 *                                 string field values that look like HTML or
 *                                 exceed 16KiB are masked to a size marker
 *
 * Inputs:
 *   - WeakSet ancestry tracks the depth-first path so DAG-shared leaves are
 *     NOT falsely reported as [Circular] (only true self-references are).
 *   - Recursion has no nesting bound; this redactor is the second-line
 *     defence-in-depth scrub. Callers should still keep payloads small.
 */
import { createHash } from 'node:crypto';

import { LogPayloadOversizeError, MAX_FIELD_BYTES } from './errors.js';

/**
 * Strict-mode allowlist (spec §5.12).
 *
 * When the logger is built with `strict: true`, only keys in this set (or
 * matching the `duration_` prefix) are emitted. All other fields are dropped
 * at the top level of the log object before any deny-list rules run.
 *
 * Pino adds `msg`, `level`, `time` to every line internally; those are NOT
 * passed through the `formatters.log` hook, so they do not need to be listed
 * here (they will always appear). We list them anyway as documentation.
 */
const STRICT_ALLOWLIST = new Set([
  'account_id',
  'study_id',
  'visit_id',
  'provider_attempt_id',
  'transport_attempt_id',
  'event',
  'error_class',
  'msg',
  'level',
  'time',
  'service',
]);
const STRICT_DURATION_PREFIX = 'duration_';

// Field NAMES whose values must NEVER reach the log line.
const REMOVE_FIELDS = new Set([
  'share_token',
  'backstory',
  'a11y_tree',
  'llm_output',
  'provider_payload',
  'password',
  'page_bytes',
  'error_detail',
]);
const API_KEY_FIELD = 'api_key';

export const __test__ = {
  STRICT_ALLOWLIST,
  REMOVE_FIELDS,
  STRICT_DURATION_PREFIX,
  API_KEY_FIELD,
};
const EMAIL_FIELD = 'email';

// Fields that look like a URL by name; if their value is a string we hash it
// even if the value isn't a *bare* https?:// URL (e.g. partial paths).
const URL_FIELD_SUFFIX = '_url';
const URL_FIELD_NAME = 'url';

// 16 KiB — strings longer than this are presumed to be captured-page bytes,
// LLM output, or provider payloads that slipped through under a different
// name. Replace with a size marker rather than logging the contents.
const MAX_STRING_LEN = 16 * 1024;

// A 32+ char hex/base64 token. Catches share-tokens, API keys, and similar
// bearer credentials that callers leak through misnamed fields.
const TOKEN_LIKE_RE = /^[A-Za-z0-9_+/=-]{32,}$/;

// A JWT — three base64url segments separated by dots, each ≥ 4 chars. Matches
// only strings that are *entirely* a JWT, so prose containing a dot doesn't
// trip it.
const JWT_RE = /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/;

// Bare URL: starts with http(s):// and contains no whitespace.
const BARE_URL_RE = /^https?:\/\/\S+$/;

// Email: minimal local + @ + domain.tld. We mask emails wherever they appear
// as an entire string value, not just under the "email" key.
const BARE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Heuristic for HTML-shaped strings (captured page bytes leaked via a generic
// field name like "body" / "content"). We are deliberately conservative here:
// only the combination of `<` and a closing `>` plus length ≥ 64 trips it,
// to avoid matching innocuous strings like "<3" or "5 > 4".
const HTML_SHAPE_RE = /<[a-zA-Z!/][^>]{0,200}>/;

export function hashUrl(salt: string, url: string): string {
  return createHash('sha256')
    .update(salt + url)
    .digest('hex')
    .slice(0, 16);
}

export function maskApiKey(key: string): string {
  const last4 = key.slice(-4);
  return `***${last4}`;
}

/**
 * Mask an email so that domain + local-part shape are preserved for log
 * grouping, but the actual identifier is gone. `nik@postgres.ai` →
 * `n***@p***.ai`. Strings without `@` are returned unchanged.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const localMasked = `${local[0] ?? '*'}***`;
  const lastDot = domain.lastIndexOf('.');
  if (lastDot <= 0) {
    return `${localMasked}@${domain[0] ?? '*'}***`;
  }
  const tld = domain.slice(lastDot); // includes the dot
  const head = domain.slice(0, lastDot);
  return `${localMasked}@${head[0] ?? '*'}***${tld}`;
}

function isBareUrl(value: unknown): value is string {
  return typeof value === 'string' && BARE_URL_RE.test(value);
}

function isBareEmail(value: unknown): value is string {
  return typeof value === 'string' && BARE_EMAIL_RE.test(value);
}

function isTokenLike(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return TOKEN_LIKE_RE.test(value) || JWT_RE.test(value);
}

function looksLikePageBytes(value: string): boolean {
  if (value.length > MAX_STRING_LEN) return true;
  return value.length >= 64 && HTML_SHAPE_RE.test(value);
}

function maskLargeString(value: string): string {
  return `[redacted:${value.length}b]`;
}

/**
 * Field-level redactor. Walks any plain object/array tree and applies the
 * §5.12 rules. Non-plain values pass through (numbers, booleans, etc).
 *
 * `ancestry` tracks the depth-first call stack only; on backtrack the node is
 * removed so DAG-shared subtrees don't get falsely flagged as [Circular].
 *
 * `strict` — when true, any top-level field NOT in STRICT_ALLOWLIST (and not
 * matching the `duration_` prefix) is dropped before deny-list rules run.
 * Nested objects inside allowlisted fields are still redacted normally.
 */
export function redact(value: unknown, salt: string, ancestry = new WeakSet<object>(), strict = false): unknown {
  if (value === null) return value;
  if (typeof value === 'string') {
    // Bare-URL string at a leaf (e.g. an array of urls): hash it. The caller
    // who handles named url fields will already have intercepted those; this
    // is the safety net for arrays / tuples / unnamed positions.
    if (BARE_URL_RE.test(value)) return hashUrl(salt, value);
    if (BARE_EMAIL_RE.test(value)) return maskEmail(value);
    if (looksLikePageBytes(value)) return maskLargeString(value);
    if (TOKEN_LIKE_RE.test(value) || JWT_RE.test(value)) return maskApiKey(value);
    return value;
  }
  if (typeof value !== 'object') return value;
  if (ancestry.has(value as object)) return '[Circular]';
  ancestry.add(value as object);
  try {
    if (Array.isArray(value)) {
      return value.map((v) => redact(v, salt, ancestry, false));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Strict-mode allowlist: drop any top-level key not in the allowlist.
      // Nested recursion always uses strict=false so inner objects are still
      // scrubbed by deny-list rules without additional field dropping.
      if (strict && !STRICT_ALLOWLIST.has(k) && !k.startsWith(STRICT_DURATION_PREFIX)) continue;

      if (REMOVE_FIELDS.has(k)) continue;

      // Spec §5.12 / issue #118 TDD #4: oversize string fields are a smell of
      // accidental payload leaks. Throw a typed error so the pino formatter
      // emits an alert event instead of silently truncating with a size
      // marker. We check this BEFORE the api_key / email / url-hash rules:
      // even a "legitimate" field name carrying 9 KiB of data is treated as
      // a leak (e.g. a 9 KiB url is itself worth alerting on).
      if (typeof v === 'string') {
        const bytes = Buffer.byteLength(v, 'utf8');
        if (bytes > MAX_FIELD_BYTES) {
          throw new LogPayloadOversizeError(k, bytes);
        }
      }

      if (k === API_KEY_FIELD && typeof v === 'string') {
        out[k] = maskApiKey(v);
        continue;
      }

      if (k === EMAIL_FIELD && typeof v === 'string') {
        out[k] = maskEmail(v);
        continue;
      }

      // Field name *_url (or just "url") with a string value → hash. We use
      // the field name as the trigger here so partial paths ("/r/abc") also
      // get hashed when the caller named the field after a URL.
      if (typeof v === 'string' && (k === URL_FIELD_NAME || k.endsWith(URL_FIELD_SUFFIX))) {
        out[`${k}_hash`] = hashUrl(salt, v);
        continue;
      }

      // Bare URL value under any other field name → hash.
      if (isBareUrl(v)) {
        out[`${k}_hash`] = hashUrl(salt, v);
        continue;
      }

      // Bare email value under any other field name → mask.
      if (isBareEmail(v)) {
        out[k] = maskEmail(v);
        continue;
      }

      // String that looks like captured-page bytes or oversized blob. We
      // check this BEFORE the token-like rule so a 20 KiB run of base64 chars
      // is reported with its size marker rather than masked to "***xxxx".
      if (typeof v === 'string' && looksLikePageBytes(v)) {
        out[k] = maskLargeString(v);
        continue;
      }

      // Token-like string under any other field name → mask. A 22-char nanoid
      // share-token is shorter than 32 chars and won't trip this rule, which
      // is why share_token has its own REMOVE_FIELDS entry; this catches the
      // longer JWT/API-key shapes that may have been misnamed by the caller.
      if (isTokenLike(v)) {
        out[k] = maskApiKey(v);
        continue;
      }

      out[k] = redact(v, salt, ancestry, false);
    }
    return out;
  } finally {
    ancestry.delete(value as object); // backtrack: remove when leaving this node
  }
}
