/**
 * routes/auth.ts — magic-link sign-in (issue #79).
 *
 * Spec refs: §4.1 (stack), §2 #26 (Resend email), §5.10 (CSP/cookie flags),
 *            §2 #20 (no existence leak → 404 on invalid/expired/used token).
 *
 * Routes:
 *   POST /api/auth/magic-link  — request a sign-in link
 *   GET  /api/auth/verify      — exchange token for session cookie
 *   POST /api/auth/sign-out    — clear session cookie
 *
 * Cookie pattern mirrors reports.ts (HMAC verification, HttpOnly, Secure,
 * SameSite=Lax). See apps/api/src/auth/session.ts for the signing helpers.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { Env } from '../env.js';
import type { ResendClient } from '../email/resend.js';
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  encodeSession,
} from '../auth/session.js';

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const MagicLinkBody = z.object({
  email: z.string().email('must be a valid email address'),
  redirect: z.string().max(200).optional(),
});

function safeRedirect(raw: string | undefined): string {
  if (!raw) return '/dashboard';
  // Allow only relative paths — block protocol-relative and absolute URLs.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) {
    return '/dashboard';
  }
  return raw;
}

// Test-only export so open-redirect prevention can be unit-tested without
// spinning up a Fastify server + Postgres.
export const __test__ = { safeRedirect };

const SESSION_7_DAYS_SECONDS = 7 * 24 * 60 * 60; // 604800
const MAGIC_LINK_EXPIRY_MINUTES = 30;

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  env: Env,
  resend: ResendClient,
): Promise<void> {
  // ---------------------------------------------------------------------------
  // POST /api/auth/magic-link
  // ---------------------------------------------------------------------------
  app.post('/api/auth/magic-link', async (req: FastifyRequest, reply: FastifyReply) => {
    // 1. Validate body.
    const parsed = MagicLinkBody.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return reply.code(400).send({ error: msg });
    }
    const { email, redirect } = parsed.data;
    const redirectPath = safeRedirect(redirect);

    // 2. Upsert account.
    const upsertResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (owner_email)
       VALUES ($1)
       ON CONFLICT (owner_email) DO UPDATE SET owner_email = EXCLUDED.owner_email
       RETURNING id`,
      [email],
    );
    const accountId = upsertResult.rows[0]?.id;
    if (!accountId) {
      return reply.code(500).send({ error: 'internal error' });
    }

    // 3. Generate token (22-char nanoid = 128 bits of entropy).
    const rawToken = nanoid(22);
    const tokenHash = sha256hex(rawToken);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);

    // 4. Store hashed token.
    await pool.query(
      `INSERT INTO auth_magic_links (account_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [accountId, tokenHash, expiresAt.toISOString()],
    );

    // 5. Build verify URL.
    const host = req.headers.host ?? 'willbuy.dev';
    const protocol = env.NODE_ENV === 'production' ? 'https' : 'http';
    const redirectParam = redirectPath !== '/dashboard'
      ? `&redirect=${encodeURIComponent(redirectPath)}`
      : '';
    const verifyUrl = `${protocol}://${host}/api/auth/verify?token=${rawToken}${redirectParam}`;

    // 6. Dev fallback: return URL in body so engineers don't need live email.
    if (env.NODE_ENV !== 'production' && env.WILLBUY_DEV_SESSION) {
      return reply.code(202).send({ verifyUrl });
    }

    // 7. Send email.
    await resend.sendMagicLink({ to: email, verifyUrl });

    return reply.code(202).send({ message: 'check your email' });
  });

  // ---------------------------------------------------------------------------
  // GET /api/auth/verify?token=<t>
  // ---------------------------------------------------------------------------
  app.get(
    '/api/auth/verify',
    async (
      req: FastifyRequest<{ Querystring: { token?: string; redirect?: string } }>,
      reply: FastifyReply,
    ) => {
      const { token: rawToken, redirect } = req.query as { token?: string; redirect?: string };
      const redirectAfter = safeRedirect(redirect);

      // §2 #20: always 404 — never leak whether token existed or was used.
      if (!rawToken) {
        return reply.code(404).send({ error: 'not found' });
      }

      const tokenHash = sha256hex(rawToken);

      // Look up the token row. Use a single query so we don't leak timing
      // info about existence vs. state.
      const result = await pool.query<{
        id: string;
        account_id: string;
        owner_email: string;
        expires_at: Date;
        used_at: Date | null;
      }>(
        `SELECT ml.id, ml.account_id, a.owner_email, ml.expires_at, ml.used_at
           FROM auth_magic_links ml
           JOIN accounts a ON a.id = ml.account_id
          WHERE ml.token_hash = $1
          LIMIT 1`,
        [tokenHash],
      );

      const row = result.rows[0];

      // §2 #20: return 404 for all invalid states (not found / expired / used).
      if (!row) {
        return reply.code(404).send({ error: 'not found' });
      }
      if (row.used_at !== null) {
        return reply.code(404).send({ error: 'not found' });
      }
      if (row.expires_at <= new Date()) {
        return reply.code(404).send({ error: 'not found' });
      }

      // Mark token used (single-use guarantee).
      await pool.query(
        `UPDATE auth_magic_links SET used_at = now() WHERE id = $1`,
        [row.id],
      );

      // Issue 7-day session cookie.
      const expiresAt = new Date(Date.now() + SESSION_7_DAYS_SECONDS * 1000);
      const cookieValue = encodeSession(
        {
          account_id: row.account_id,
          owner_email: row.owner_email,
          expires_at: expiresAt.toISOString(),
        },
        env.SESSION_HMAC_KEY,
      );

      const setCookie = buildSetCookieHeader(
        cookieValue,
        env.NODE_ENV,
        SESSION_7_DAYS_SECONDS,
      );
      void reply.header('Set-Cookie', setCookie);

      return reply.code(302).redirect(redirectAfter);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/auth/sign-out
  // ---------------------------------------------------------------------------
  app.post('/api/auth/sign-out', async (_req: FastifyRequest, reply: FastifyReply) => {
    const clearCookie = buildClearCookieHeader(env.NODE_ENV);
    void reply.header('Set-Cookie', clearCookie);
    return reply.code(302).redirect('/sign-in');
  });
}
