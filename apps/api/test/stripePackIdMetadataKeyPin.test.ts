/**
 * stripePackIdMetadataKeyPin.test.ts — spec-pin for the 'pack_id' metadata
 * key used to pass pack identity through Stripe Checkout (spec §4.1 / §5.6).
 *
 * The metadata key 'pack_id' is set in checkout.ts when creating the
 * Checkout Session:
 *   metadata: { pack_id: packId }
 *
 * And read back in stripe-webhook.ts when the payment completes:
 *   session.metadata?.['pack_id']
 *
 * If renamed in either file (e.g., to 'packId' or 'pack'), the webhook
 * can't look up the pack and logs a warning — the credit_ledger INSERT is
 * skipped and the account is silently not credited despite a successful payment.
 *
 * The two files use different syntax:
 *   checkout.ts:       { pack_id: packId }  — object shorthand notation
 *   stripe-webhook.ts: ['pack_id']           — string indexer
 *
 * Both must use the same key string 'pack_id'.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checkoutSrc = readFileSync(resolve(here, '..', 'src', 'routes', 'checkout.ts'), 'utf8');
const webhookSrc = readFileSync(resolve(here, '..', 'src', 'routes', 'stripe-webhook.ts'), 'utf8');

describe("Stripe 'pack_id' metadata key coordination (spec §4.1)", () => {
  it("checkout.ts sets metadata.pack_id on the Checkout Session", () => {
    expect(checkoutSrc).toContain("pack_id: packId");
  });

  it("stripe-webhook.ts reads metadata['pack_id'] from the completed session", () => {
    expect(webhookSrc).toContain("['pack_id']");
  });

  it("the metadata key in checkout.ts is the string 'pack_id' (not 'packId' or 'pack')", () => {
    // The Zod schema uses pack_id as the field name — confirm it appears in metadata context.
    expect(checkoutSrc).toContain("metadata: { pack_id:");
  });

  it("webhook reads with optional chaining on metadata before ['pack_id']", () => {
    // Defensive access: session.metadata?.['pack_id'] — metadata can be null.
    expect(webhookSrc).toContain("metadata?.['pack_id']");
  });
});
