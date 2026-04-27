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
 * Labeled-context proximity detector — spec §5.9 + §6.1 boundary rule.
 *
 * A generic 32+ char hex/base64url blob is redacted ONLY when it appears
 * within 32 chars (character distance, whitespace/newlines included) AFTER
 * a label keyword + separator (`=` or `:`). The 32-char window is the gap
 * between the end of the separator character and the START of the blob.
 *
 * Implementation: scan for each label regex match, extract the window of
 * up to 32 chars immediately after the separator, and search for a 32+ char
 * blob inside that window. If found, replace it in the working string.
 *
 * The `nonce` label is explicitly EXCLUDED from the label set — CSP nonces
 * are designed to leak (they're embedded in HTML by the server for browsers
 * to read) and are not credentials. `v` (cache buster) is also excluded.
 *
 * Spec §6.1 boundary assertions:
 *   label 31 chars away → redact   (31 ≤ 32)
 *   label 33 chars away → leave    (33 > 32)
 *   two labels at 29 and 35 chars → redact (29-char label fires)
 *   label + newline → redact       (newlines count toward distance)
 *   overlapping labels             → redact
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

export const __test__ = { LABEL_KEYWORDS };

const LABEL_PATTERN = LABEL_KEYWORDS.join('|');

/** Proximity window (chars) from end of separator to start of blob. */
export const LABEL_PROXIMITY_CHARS = 32;

/**
 * Matches a label keyword + separator. The separator is ONE `=` or `:`
 * character only (no surrounding whitespace). The gap between the separator
 * and the value blob is part of the proximity window, so consuming it in the
 * regex would bypass the 32-char distance check.
 */
const RE_LABEL_ANCHOR = new RegExp(
  // Opening boundary: start-of-string OR a non-word char (lookbehind)
  String.raw`(?:^|(?<=[^A-Za-z0-9_]))` +
    // The label keyword
    String.raw`(?:${LABEL_PATTERN})` +
    // Separator: exactly ONE `=` or `:` (no trailing whitespace — the gap is
    // the proximity window)
    String.raw`[:=]`,
  'gi',
);

/** Matches a 32+ char hex/base64url blob (the thing we want to redact). */
const RE_BLOB = /[A-Za-z0-9_\-+/]{32,}/g;

/**
 * Strict email check — used to decide whether a blob that was triggered
 * by a label should be classified as an email value instead.
 */
function looksLikeEmail(s: string): boolean {
  return /@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.test(s);
}

/**
 * Proximity scan for the labeled-context rule (spec §5.9 / §6.1).
 *
 * Finds every label anchor in `s`, then for each anchor looks within the
 * next `LABEL_PROXIMITY_CHARS` chars for a 32+ char blob. Returns the
 * string with all matching blobs replaced by `[REDACTED:labeled_secret]`,
 * and a count of replacements.
 *
 * The scan is left-to-right; once a blob position is redacted it is no
 * longer subject to a second replacement. We use an index-based approach
 * so we can correctly rebuild the string with replacements without
 * fighting regex state.
 */
function redactLabeledSecrets(
  input: string,
  counts: Partial<Record<RedactionKind, number>>,
): string {
  // Collect all [start, end) intervals of blobs that should be redacted.
  // We use a Set of start positions to deduplicate (overlapping labels can
  // trigger the same blob multiple times).
  const toRedact = new Set<number>();

  // Reset lastIndex for RE_LABEL_ANCHOR since it has the /g flag.
  RE_LABEL_ANCHOR.lastIndex = 0;

  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = RE_LABEL_ANCHOR.exec(input)) !== null) {
    // `anchorMatch.index` = start of label keyword.
    // The separator ends at `anchorMatch.index + anchorMatch[0].length`.
    const sepEnd = anchorMatch.index + anchorMatch[0].length;

    // The proximity window: [sepEnd, sepEnd + LABEL_PROXIMITY_CHARS)
    const windowEnd = sepEnd + LABEL_PROXIMITY_CHARS;

    // Find the first 32+ char blob that STARTS inside the window. We search
    // the full string from sepEnd but only accept matches that start within
    // the window — the blob may extend beyond the window boundary.
    RE_BLOB.lastIndex = sepEnd;
    const blobMatch = RE_BLOB.exec(input);
    if (blobMatch === null) continue;
    // The blob must START within the proximity window.
    if (blobMatch.index >= windowEnd) continue;

    // Absolute start/end of blob in the full string.
    const blobStart = blobMatch.index;
    const blobEnd = blobStart + blobMatch[0].length;

    if (looksLikeEmail(input.slice(blobStart, blobEnd))) continue;

    // Mark every position in the blob for redaction.
    for (let i = blobStart; i < blobEnd; i++) {
      toRedact.add(i);
    }
    counts.labeled_secret = (counts.labeled_secret ?? 0) + 1;
  }

  if (toRedact.size === 0) return input;

  // Rebuild string with blobs replaced. Walk char-by-char; when we hit the
  // start of a marked range, emit the placeholder and skip the range.
  let out = '';
  let i = 0;
  while (i < input.length) {
    if (!toRedact.has(i)) {
      out += input[i];
      i++;
    } else {
      // Find end of this contiguous marked region.
      let j = i + 1;
      while (j < input.length && toRedact.has(j)) j++;
      out += PLACEHOLDER('labeled_secret');
      // Undo the count increment if there were multiple anchors for the same
      // blob; we only counted once above because we use toRedact as a Set.
      i = j;
    }
  }
  return out;
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

  // Labeled-context proximity fallback (spec §5.9 / §6.1).
  s = redactLabeledSecrets(s, counts);

  return { redacted: s, counts, redactor_v: REDACTOR_VERSION };
}
