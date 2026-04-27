/**
 * checkoutStripeRedirectParamsPin.test.ts — spec-pin for the Stripe Checkout
 * fallback redirect URLs in apps/api/src/routes/checkout.ts (spec §4.1, §5.6).
 *
 * The success_url and cancel_url fallbacks embed two query parameters that the
 * web app (apps/web/app/dashboard/credits/page.tsx) reads to show banners:
 *   ?success=1    — shown after Stripe redirects back on successful payment
 *   ?cancelled=1  — shown after Stripe redirects back on cancelled payment
 *
 * The web app checks `params.success === '1'` and `params.cancelled === '1'`.
 * If the query param names or values are renamed in the fallback URLs but not
 * in the web page (or vice versa), the success/cancel banners stop appearing —
 * silent regression with no error, just missing UI feedback.
 *
 * These are plain string literals in the fallback values of
 * `success_url: env.STRIPE_SUCCESS_URL ?? '<fallback>'` and similarly for
 * cancel_url. The STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL env vars can
 * override them in production.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'routes', 'checkout.ts'), 'utf8');

describe("checkout.ts Stripe redirect URL query params (spec §4.1 / §5.6)", () => {
  it("success fallback URL contains ?success=1 query param", () => {
    expect(src).toContain('?success=1');
  });

  it("cancel fallback URL contains ?cancelled=1 query param", () => {
    expect(src).toContain('?cancelled=1');
  });

  it("both redirects point to /dashboard/credits (fix #215)", () => {
    const successIdx = src.indexOf('/dashboard/credits?success=1');
    const cancelIdx = src.indexOf('/dashboard/credits?cancelled=1');
    expect(successIdx).toBeGreaterThan(-1);
    expect(cancelIdx).toBeGreaterThan(-1);
  });

  it("STRIPE_SUCCESS_URL env var overrides the success fallback", () => {
    expect(src).toContain('STRIPE_SUCCESS_URL');
  });
});
