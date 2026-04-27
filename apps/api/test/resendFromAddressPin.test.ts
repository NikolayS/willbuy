/**
 * resendFromAddressPin.test.ts — spec-pin for the Resend "from" addresses
 * in apps/api/src/email/resend.ts (spec §2 #26).
 *
 * Two sender addresses are used:
 *   'willbuy.dev <auth@willbuy.dev>'  — magic-link sign-in emails
 *   'alerts@willbuy.dev'              — daily cap 50% warning emails
 *
 * Both must be verified with Resend for the DNS domain willbuy.dev.
 * Renaming either without updating the Resend dashboard verification
 * causes emails to bounce silently (403 from Resend's API, which the
 * caller converts to a thrown Error and lets the user's sign-in attempt fail).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'email', 'resend.ts'), 'utf8');

describe("resend.ts email sender addresses (spec §2 #26)", () => {
  it("magic-link sender is 'willbuy.dev <auth@willbuy.dev>'", () => {
    expect(src).toContain("'willbuy.dev <auth@willbuy.dev>'");
  });

  it("cap-warning sender is 'alerts@willbuy.dev'", () => {
    expect(src).toContain("'alerts@willbuy.dev'");
  });

  it("both from addresses appear in from: field context", () => {
    const authFromIdx = src.indexOf("from: 'willbuy.dev <auth@willbuy.dev>'");
    const alertsFromIdx = src.indexOf("from: 'alerts@willbuy.dev'");
    expect(authFromIdx).toBeGreaterThan(-1);
    expect(alertsFromIdx).toBeGreaterThan(-1);
  });

  it("magic-link sender appears before cap-warning sender in the file", () => {
    const authIdx = src.indexOf("auth@willbuy.dev");
    const alertsIdx = src.indexOf("alerts@willbuy.dev");
    expect(authIdx).toBeGreaterThan(-1);
    expect(alertsIdx).toBeGreaterThan(authIdx);
  });
});
