/**
 * authBearerTokenPin.test.ts — spec-pin for the Bearer token scheme
 * in apps/api/src/auth/api-key.ts (spec §2 #21, §5.8).
 *
 * The API key middleware reads the Authorization header and validates that
 * it starts with 'Bearer ' (capital B, trailing space). It then slices
 * off exactly 'Bearer '.length (7) characters to extract the raw token.
 *
 * Three inline string literals must stay in sync:
 *   'authorization'  — the normalized lowercase HTTP header name
 *   'Bearer '        — the scheme prefix (RFC 7235 §5.1.1 — token68)
 *   authHeader.slice('Bearer '.length)  — implicit slice offset = 7
 *
 * Changing 'Bearer ' to 'bearer ' changes the startsWith check behavior
 * (Node.js serves headers in lowercase but the scheme comparison is
 * case-sensitive in this code). Changing to 'Token ' or 'ApiKey '
 * breaks all API clients that use the Authorization: Bearer scheme.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'auth', 'api-key.ts'), 'utf8');

describe("api-key.ts Bearer token auth scheme (spec §2 #21)", () => {
  it("reads the 'authorization' header (lowercase, Node.js normalized)", () => {
    expect(src).toContain("req.headers['authorization']");
  });

  it("uses 'Bearer ' (capital B, trailing space) as the scheme prefix", () => {
    expect(src).toContain("'Bearer '");
  });

  it("slices off the Bearer prefix using 'Bearer '.length", () => {
    expect(src).toContain("'Bearer '.length");
  });

  it("rejects requests without a Bearer prefix", () => {
    expect(src).toContain("startsWith('Bearer ')");
  });
});
