/**
 * Redactor — spec §5.9.
 *
 * Detects PII / credentials and replaces them with `[REDACTED:<kind>]`.
 * Runs BEFORE persistence (object storage write) AND BEFORE LLM submission
 * (in the visitor worker — separate path; we only handle the persistence
 * pre-pass here).
 *
 * Versioning: REDACTOR_VERSION is persisted on the capture row so that a
 * future redactor revision can reprocess older artifacts deterministically.
 *
 * False-positive carve-outs (spec §5.9 boundary rule):
 *  - 40-char asset-URL hash
 *  - 64-char CSP nonce
 *  - 64-char SKU
 *  - commit SHAs (40-char hex appearing in narrative or version strings)
 *  - cache-busted image URLs (`?v=<hex>`)
 *
 * Generic 32+ char hex/base64 tokens are redacted ONLY when they appear in
 * "labeled context" — adjacent to a token-like label such as `key=`,
 * `secret:`, `Authorization: Bearer `, etc. Bare hex blobs in URLs,
 * version strings, or text content are left alone.
 */

export const REDACTOR_VERSION = 1;

export type RedactionKind =
  | 'openai_secret'
  | 'slack_token'
  | 'aws_access_key'
  | 'github_pat'
  | 'gitlab_pat'
  | 'jwt'
  | 'email'
  | 'labeled_secret';

export type RedactionResult = {
  redacted: string;
  /** Per-kind counts. Useful for observability + audit. */
  counts: Partial<Record<RedactionKind, number>>;
  redactor_v: number;
};

const PLACEHOLDER = (kind: RedactionKind): string => `[REDACTED:${kind}]`;

// Detector ordering matters: high-specificity prefixes first, then the
// labeled-context fallback. Each detector is a single regex that matches
// the FULL secret value (the placeholder replaces the whole match).

// Spec §5.9 explicit detectors.
const RE_OPENAI = /\bsk-[A-Za-z0-9_-]{16,}\b/g;
const RE_SLACK = /\bxoxb-[A-Za-z0-9-]{10,}\b/g;
const RE_AWS = /\bAKIA[0-9A-Z]{12,}\b/g;
const RE_GITHUB = /\bghp_[A-Za-z0-9]{20,}\b/g;
const RE_GITLAB = /\bglpat-[A-Za-z0-9_-]{10,}\b/g;
// JWTs: three base64url segments separated by dots, each ≥ 4 chars.
// We require the header segment to start with `eyJ` (the base64url of
// `{"`) to avoid matching unrelated dotted tokens like "1.2.3" version
// strings.
const RE_JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g;
// Conservative email matcher. Local-part allows the most common chars
// (per RFC 5322's atext, restricted further); we deliberately don't try
// to be a perfect RFC parser.
const RE_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g;

/**
 * Labeled-context detector — the spec §5.9 boundary rule.
 *
 * Match a label keyword followed by `=` or `:` (with optional whitespace,
 * optional `Bearer `/`Basic ` token-type prefix, optional surrounding
 * quotes), then a 32+ char hex/base64url blob.
 *
 * The KEY insight: we anchor on the LABEL, not on the blob. A bare
 * 40-char hex string in a URL has no label, so it doesn't match — that's
 * how asset hashes / commit SHAs / SKUs / nonces avoid redaction.
 *
 * The `nonce` label is explicitly EXCLUDED from the label set — CSP
 * nonces are designed to leak (they're embedded in HTML by the server
 * for browsers to read) and are not credentials.
 *
 * `v` (cache buster) is also excluded.
 */
const LABEL_KEYWORDS = [
  'api[_-]?key',
  'apikey',
  'access[_-]?token',
  'auth[_-]?token',
  'authorization',
  'bearer',
  'client[_-]?secret',
  'private[_-]?key',
  'refresh[_-]?token',
  'secret',
  'session[_-]?token',
  'token',
  'password',
  'passwd',
  'pwd',
];

const LABEL_PATTERN = LABEL_KEYWORDS.join('|');

// Two flavors: `label=value` and `label: value` (with optional Bearer/Basic
// prefix and optional quotes around the value).
const RE_LABELED_SECRET = new RegExp(
  // Opening boundary: start-of-string OR a non-word char (so `xapi_key=` does
  // not match — but `?api_key=` does).
  String.raw`(^|[^A-Za-z0-9_])` +
    // The label itself
    String.raw`(?:${LABEL_PATTERN})` +
    // Separator: `=` or `:` with optional whitespace
    String.raw`\s*[:=]\s*` +
    // Optional auth scheme + space (Bearer / Basic / Token)
    String.raw`(?:(?:Bearer|Basic|Token)\s+)?` +
    // Optional opening quote
    String.raw`["']?` +
    // The value: 32+ chars of hex/base64url
    String.raw`([A-Za-z0-9_\-+/]{32,})`,
  'gi',
);

/**
 * Strict email check — used to decide whether the `labeled_secret`
 * detector fired on something that should have been classified as an
 * email value. This keeps the counts honest.
 */
function looksLikeEmail(s: string): boolean {
  return /@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.test(s);
}

export function redact(input: string): RedactionResult {
  const counts: Partial<Record<RedactionKind, number>> = {};
  let s = input;

  const apply = (re: RegExp, kind: RedactionKind): void => {
    s = s.replace(re, () => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      return PLACEHOLDER(kind);
    });
  };

  // Order: most specific first.
  apply(RE_OPENAI, 'openai_secret');
  apply(RE_SLACK, 'slack_token');
  apply(RE_AWS, 'aws_access_key');
  apply(RE_GITHUB, 'github_pat');
  apply(RE_GITLAB, 'gitlab_pat');
  apply(RE_JWT, 'jwt');
  apply(RE_EMAIL, 'email');

  // Labeled-context fallback. We use a replace function so we can preserve
  // the leading boundary char and only redact the value portion.
  s = s.replace(RE_LABELED_SECRET, (match, leading: string, value: string) => {
    if (looksLikeEmail(value)) return match;
    counts.labeled_secret = (counts.labeled_secret ?? 0) + 1;
    // Preserve everything BEFORE the value, then drop in the placeholder.
    // We rebuild from the match by stripping the trailing `value` once.
    const head = match.slice(0, match.length - value.length);
    return head + PLACEHOLDER('labeled_secret');
  });

  return { redacted: s, counts, redactor_v: REDACTOR_VERSION };
}
