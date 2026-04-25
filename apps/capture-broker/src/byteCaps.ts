/**
 * Byte caps — spec §5.13 + §2 #6 (defense-in-depth).
 *
 * The broker enforces these AFTER schema parse, but BEFORE redaction +
 * persistence. We compute decoded byte length from the base64 string
 * length WITHOUT actually decoding — `decoded = floor(len*3/4) - padding`
 * — to avoid allocating a large Buffer just to reject it.
 */
export const BYTE_CAPS = {
  /** Largest single Unix-socket message we will read (envelope + payload). */
  MESSAGE_BYTES: 32 * 1024 * 1024,
  /** Decoded a11y-tree size cap (spec §5.13). */
  A11Y_TREE_BYTES: 10 * 1024 * 1024,
  /** Decoded screenshot size cap. v0.1 is conservative; spec §5.13 + §5.17. */
  SCREENSHOT_BYTES: 5 * 1024 * 1024,
} as const;

/**
 * Estimate the decoded byte length of a base64 string without allocating
 * a Buffer. Returns `null` if the string is not plausibly base64 (length
 * not a multiple of 4 OR contains non-base64 chars). Whitespace inside
 * the input is tolerated (browsers and some encoders insert linebreaks).
 */
export function decodedBase64Bytes(b64: string): number | null {
  // Tolerate embedded whitespace. We do NOT tolerate other junk; that's
  // a malformed payload and we reject upstream.
  let trimmed = '';
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue;
    trimmed += b64[i];
  }
  if (trimmed.length === 0) return 0;
  if (trimmed.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  let pad = 0;
  if (trimmed.endsWith('==')) pad = 2;
  else if (trimmed.endsWith('=')) pad = 1;
  return (trimmed.length / 4) * 3 - pad;
}
