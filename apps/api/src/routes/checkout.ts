/**
 * routes/checkout.ts — POST /checkout/sessions (issue #36).
 *
 * Creates a Stripe Checkout session for one of the three credit packs (§5.6).
 * Behind the api-key middleware; uses req.account.id as client_reference_id
 * so the webhook can reconcile the payment back to the account.
 *
 * Spec refs: §4.1 (Stripe Checkout), §5.6 (pack tiers).
 * Fix #73: wrap stripe.checkout.sessions.create in try/catch; map to 502
 * without leaking Stripe internals to the client.
 */

import { z } from 'zod';
import Stripe from 'stripe';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { buildApiKeyMiddleware } from '../auth/api-key.js';
import { buildSessionMiddleware } from '../auth/session.js';
import type { Env } from '../env.js';
import { PACKS, type PackId } from '../billing/packs.js';

const CreateSessionBodySchema = z.object({
  pack_id: z.enum(['starter', 'growth', 'scale']),
});

export async function registerCheckoutRoutes(
  app: FastifyInstance,
  pool: Pool,
  env: Env,
  stripe: Stripe,
): Promise<void> {
  const apiKeyMiddleware = buildApiKeyMiddleware(pool);

  app.post(
    '/checkout/sessions',
    { preHandler: [apiKeyMiddleware] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const account = req.account!;

      const bodyResult = CreateSessionBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        return reply.code(400).send({ error: 'invalid pack_id' });
      }

      const packId: PackId = bodyResult.data.pack_id;
      const pack = PACKS[packId];

      let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
      try {
        session = await stripe.checkout.sessions.create({
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [
            {
              price: pack.price_id,
              quantity: 1,
            },
          ],
          client_reference_id: String(account.id),
          metadata: { pack_id: packId },
          // success_url and cancel_url are required by Stripe; use env if set,
          // otherwise use fallback placeholders (adequate for test mode).
          success_url: env.STRIPE_SUCCESS_URL ?? 'https://willbuy.dev/credits?success=1',
          cancel_url: env.STRIPE_CANCEL_URL ?? 'https://willbuy.dev/credits?cancelled=1',
        });
      } catch (err) {
        // Log with Fastify's logger (Fastify logger pattern: req.log.error).
        // Do NOT forward Stripe error details to the client — they may contain
        // internal API messages, price-ID hints, or other sensitive internals.
        req.log.error(err, 'stripe-checkout-create-failed');
        return reply
          .code(502)
          .send({ error: 'payment provider unavailable, try again' });
      }

      return reply.code(200).send({ url: session.url });
    },
  );

  // ── POST /api/checkout/sessions (session-cookie auth) ─────────────────────
  //
  // Session-cookie mirror of POST /checkout/sessions. Allows dashboard users
  // to initiate Stripe checkout without a programmatic API key in their browser.
  // Identical Stripe session creation logic; only auth differs.
  const sessionMiddleware = buildSessionMiddleware(env.SESSION_HMAC_KEY, env.NODE_ENV);

  app.post(
    '/api/checkout/sessions',
    { preHandler: [sessionMiddleware] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const account = req.account!;

      const bodyResult = CreateSessionBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        return reply.code(400).send({ error: 'invalid pack_id' });
      }

      const packId: PackId = bodyResult.data.pack_id;
      const pack = PACKS[packId];

      let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
      try {
        session = await stripe.checkout.sessions.create({
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [{ price: pack.price_id, quantity: 1 }],
          client_reference_id: String(account.id),
          metadata: { pack_id: packId },
          success_url: env.STRIPE_SUCCESS_URL ?? 'https://willbuy.dev/credits?success=1',
          cancel_url: env.STRIPE_CANCEL_URL ?? 'https://willbuy.dev/credits?cancelled=1',
        });
      } catch (err) {
        req.log.error(err, 'stripe-checkout-create-failed');
        return reply.code(502).send({ error: 'payment provider unavailable, try again' });
      }

      return reply.code(200).send({ url: session.url });
    },
  );
}
