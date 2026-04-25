/**
 * routes/stripe-webhook.ts — POST /stripe/webhook (issue #36).
 *
 * NOT behind the api-key middleware — Stripe POSTs directly.
 * Verifies the Stripe-Signature header with STRIPE_WEBHOOK_SECRET.
 *
 * On checkout.session.completed:
 *   - Looks up pack from session.metadata.pack_id.
 *   - INSERTs a credit_ledger row with kind='top_up', cents=<pack.cents>,
 *     idempotency_key=event.id.
 *   - The UNIQUE(idempotency_key) constraint makes this exactly-once
 *     under retry storms (§16).
 *
 * Body-parsing note: Stripe signature verification requires the RAW request
 * body string (not the parsed JSON object). This route is registered in an
 * encapsulated Fastify scope so the `application/json` content-type parser
 * override is NOT visible to other routes.
 *
 * Spec refs: §4.1 (signed webhook idempotent on event id), §16 (idempotency),
 * §5.6 (pack tiers).
 */

import type Stripe from 'stripe';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { PACKS, type PackId } from '../billing/packs.js';

export async function registerStripeWebhookRoute(
  app: FastifyInstance,
  pool: Pool,
  stripe: Stripe,
  webhookSecret: string,
): Promise<void> {
  // Register inside an encapsulated scope so the application/json parser
  // override is local to this scope and doesn't affect other routes.
  await app.register(async function webhookScope(scope) {
    // Stripe requires the raw body string for HMAC signature verification.
    // Override the JSON parser inside this scope to receive the body as a string.
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      function stripeBodyParser(
        _req: FastifyRequest,
        body: string,
        done: (err: Error | null, body?: unknown) => void,
      ) {
        done(null, body);
      },
    );

    scope.post('/stripe/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
      const sig = req.headers['stripe-signature'];
      if (!sig || typeof sig !== 'string') {
        return reply.code(400).send({ error: 'missing stripe-signature' });
      }

      const rawBody = req.body as string;
      if (!rawBody) {
        return reply.code(400).send({ error: 'empty body' });
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'signature verification failed';
        return reply.code(400).send({ error: msg });
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;

        const accountId = session.client_reference_id;
        if (!accountId) {
          // Missing client_reference_id — can't reconcile; log and ack.
          req.log.warn({ eventId: event.id }, 'stripe webhook: missing client_reference_id');
          return reply.code(200).send({ received: true });
        }

        const rawPackId = session.metadata?.['pack_id'];
        if (!rawPackId || !(rawPackId in PACKS)) {
          req.log.warn({ eventId: event.id, rawPackId }, 'stripe webhook: unknown pack_id');
          return reply.code(200).send({ received: true });
        }

        const packId = rawPackId as PackId;
        const pack = PACKS[packId];

        // INSERT with ON CONFLICT DO NOTHING — idempotency via UNIQUE(idempotency_key).
        // kind='top_up' allows NULL provider_attempt_id per migration CHECK constraint.
        await pool.query(
          `INSERT INTO credit_ledger (account_id, kind, cents, idempotency_key)
           VALUES ($1, 'top_up', $2, $3)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [accountId, pack.cents, event.id],
        );
      }

      return reply.code(200).send({ received: true });
    });
  });
}
