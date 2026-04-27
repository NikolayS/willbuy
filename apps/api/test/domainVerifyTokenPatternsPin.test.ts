/**
 * domainVerifyTokenPatternsPin.test.ts — spec-pin for the domain
 * verification token patterns in apps/api/src/routes/domains.ts (spec §2 #1).
 *
 * Three verification methods (§2 #1) each use the same token string but
 * embed it in a method-specific pattern:
 *
 *   DNS TXT:   'willbuy-verify=<token>'
 *   Well-known: GET /.well-known/willbuy-verify (body equals raw token)
 *   Meta tag:  <meta name="willbuy-verify" content="<token>">
 *
 * The probe functions check that the token appears in the expected format.
 * The methods.{dns, well_known, meta} response object shows users what to
 * configure — they use these exact strings when setting up their verification.
 *
 * If 'willbuy-verify' is renamed (e.g. to 'willbuy-domain-token'), existing
 * domain configurations become invalid — users would need to update their
 * DNS records, well-known files, or meta tags to match the new prefix.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'routes', 'domains.ts'), 'utf8');

describe("domains.ts verification token patterns (spec §2 #1)", () => {
  it("DNS TXT record probe checks 'willbuy-verify=' prefix in TXT data", () => {
    // Line 169: const expected = `willbuy-verify=${token}`;
    expect(src).toContain("willbuy-verify=");
  });

  it("well-known path probe fetches /.well-known/willbuy-verify", () => {
    // Line 227: const url = `https://${domain}/.well-known/willbuy-verify`;
    expect(src).toContain("/.well-known/willbuy-verify");
  });

  it("meta tag probe looks for name='willbuy-verify' in HTML", () => {
    // Line 255: `<meta\\s+[^>]*name=["']willbuy-verify["']...`
    expect(src).toContain("name=[\"']willbuy-verify[\"']");
  });

  it("methods object in POST response uses 'willbuy-verify' prefix for all three methods", () => {
    // Lines 318-320: dns/well_known/meta show the user what to configure.
    const count = (src.match(/willbuy-verify/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(5);
  });
});
