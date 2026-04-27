/**
 * authMagicLinkQueryParamsPin.test.ts — spec-pin for the magic-link URL
 * query parameter names in apps/api/src/routes/auth.ts (spec §2 #26).
 *
 * The magic-link URL contains two query parameters:
 *   ?token=<rawToken>     — the 22-char nanoid raw token for single-use auth
 *   &redirect=<path>      — optional path to redirect to after successful auth
 *
 * Both names are inline string literals in the URL template and in the
 * Querystring type declaration for the verify endpoint. If either is renamed
 * in the link-generation path but not in the verify handler (or vice versa),
 * all sign-in attempts fail silently — users get a 404 or an infinite
 * redirect loop.
 *
 * The web app (sign-in/page.tsx) also passes `redirect: redirectPath` in
 * the POST body, matching the Zod schema `redirect: z.string().max(200)`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'routes', 'auth.ts'), 'utf8');

describe("auth.ts magic-link URL query parameter names (spec §2 #26)", () => {
  it("magic-link URL uses ?token= as the query param name", () => {
    expect(src).toContain('?token=${rawToken}');
  });

  it("magic-link URL uses &redirect= as the optional query param name", () => {
    expect(src).toContain('&redirect=');
  });

  it("verify endpoint reads 'token' from Querystring", () => {
    expect(src).toContain("token?: string");
  });

  it("verify endpoint's Querystring type includes 'redirect'", () => {
    // The GET /api/auth/verify handler declares { token?: string; redirect?: string }.
    expect(src).toContain('redirect?: string');
  });
});
