/**
 * stripeWebhookEventTypePin.test.ts — spec-pin for the Stripe webhook
 * event type in apps/api/src/routes/stripe-webhook.ts (spec §4.1 / §16).
 *
 * The webhook handler matches on event.type === 'checkout.session.completed'
 * to trigger the credit_ledger INSERT. If this string is misspelled or
 * changed (e.g., to 'checkout.session.complete' without the 'd'), Stripe's
 * webhook payload would never match and no credit_ledger row would be written
 * — payments would succeed at Stripe but accounts would never be credited.
 *
 * The event type is a Stripe API constant; it does not appear in Stripe's
 * TypeScript SDK as a named exported constant, so it must be checked as a
 * source-text literal.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '..', 'src', 'routes', 'stripe-webhook.ts'), 'utf8');

describe("stripe-webhook.ts Stripe event type (spec §4.1)", () => {
  it("matches on 'checkout.session.completed' (exact Stripe event name)", () => {
    expect(src).toContain("'checkout.session.completed'");
  });

  it("event type check uses strict equality (=== not includes/startsWith)", () => {
    expect(src).toContain("=== 'checkout.session.completed'");
  });

  it("'top_up' is the credit_ledger kind for Stripe checkout payments", () => {
    expect(src).toContain("'top_up'");
  });

  it("'top_up' kind is used in the INSERT within the checkout.session.completed block", () => {
    // Both appear in the file — the INSERT containing 'top_up' follows the event.type check.
    const eventIdx = src.indexOf("event.type === 'checkout.session.completed'");
    const insertIdx = src.indexOf("'top_up'", eventIdx);
    expect(eventIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(eventIdx);
  });
});
