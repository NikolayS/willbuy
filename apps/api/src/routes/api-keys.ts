/**
 * routes/api-keys.ts — API-key management UI (issue #81).
 *
 * Spec refs:
 *   §4.1   — API-key auth is v0.1 primary auth for programmatic access.
 *   §5.1   — api_keys table: key_hash, last_used_at, revoked_at.
 *   §2 #21 — ≤ 2 active keys per account (enforced at DB level by trigger).
 *   §2 #22 — keys masked to last 4 chars in logs.
 *   §5.10  — wb_session HMAC cookie auth for the management UI.
 *   §2 #20 — no existence leak (404 generic on cross-account access).
 *
 * All three routes are behind buildSessionMiddleware (cookie-auth, NOT bearer).
 * They are mounted at /api/api-keys/* alongside the bearer-authenticated
 * /studies/* routes which use buildApiKeyMiddleware on a separate path.
 *
 * Wire format:
 *   sk_live_<24-char-base62>   = 32 chars total
 *   prefix = sk_live_X  (first 10 chars of the full key — first display token)
 *   key_hash = sha256_hex(full_key)
 *
 * The raw key is shown to the caller exactly ONCE (in the POST response).
 * Subsequent GETs return only the prefix; the key_hash is never exposed
 * over the wire.
 */

import { createHash } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { buildSessionMiddleware } from '../auth/session.js';
import type { Env } from '../env.js';

// base62 alphabet — URL-safe, no ambiguous chars in handwritten copies
// (excludes 0/O/1/l confusion is intentionally NOT done here because base62
//  is canonical for shareable secrets and copy/paste is the supported flow).
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PREFIX = 'sk_live_';
const KEY_BODY_LEN = 24; // 24 chars of entropy after the prefix → 32-char key total
const PREFIX_DISPLAY_LEN = PREFIX.length + 1; // sk_live_ + 1 char = "sk_live_X"

export const __test__ = { BASE62, PREFIX, KEY_BODY_LEN, PREFIX_DISPLAY_LEN };

const nanoid = customAlphabet(BASE62, KEY_BODY_LEN);

const CreateKeyBodySchema = z.object({
  label: z.string().trim().min(1, 'label is required').max(80, 'label is too long'),
});

interface ApiKeyRow {
  id: string;
  label: string;
  prefix: string;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function generateKey(): string {
  return PREFIX + nanoid();
}

function maskKey(key: string): string {
  return `***${key.slice(-4)}`;
}

function rowToApiResponse(r: ApiKeyRow): {
  id: number;
  label: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
} {
  return {
    id: Number(r.id),
    label: r.label,
    prefix: r.prefix,
    last_used_at: r.last_used_at ? r.last_used_at.toISOString() : null,
    revoked_at: r.revoked_at ? r.revoked_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  };
}

export async function registerApiKeyRoutes(
  app: FastifyInstance,
  pool: Pool,
  env: Env,
): Promise<void> {
  const sessionMiddleware = buildSessionMiddleware(env.SESSION_HMAC_KEY, env.NODE_ENV);

  // ---------------------------------------------------------------------------
  // GET /api/api-keys — list caller's keys (active + revoked, scoped to account).
  // ---------------------------------------------------------------------------
  app.get(
    '/api/api-keys',
    { preHandler: [sessionMiddleware] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const account = req.account!;
      const result = await pool.query<ApiKeyRow>(
        `SELECT id::text, label, prefix, last_used_at, revoked_at, created_at
           FROM api_keys
          WHERE account_id = $1
          ORDER BY created_at DESC`,
        [String(account.id)],
      );
      return reply.code(200).send(result.rows.map(rowToApiResponse));
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/api-keys — create a key for the caller's account.
  //   Returns the ONLY view of the raw key value the caller will ever get.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/api-keys',
    { preHandler: [sessionMiddleware] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const account = req.account!;

      // Body validation. Zod strips & rejects label-only payloads.
      const parsed = CreateKeyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid request body',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      const { label } = parsed.data;

      const rawKey = generateKey();
      const keyHash = sha256hex(rawKey);
      const prefix = rawKey.slice(0, PREFIX_DISPLAY_LEN);

      let inserted: ApiKeyRow;
      try {
        const result = await pool.query<ApiKeyRow>(
          `INSERT INTO api_keys (account_id, key_hash, prefix, label)
                VALUES ($1, $2, $3, $4)
             RETURNING id::text, label, prefix, last_used_at, revoked_at, created_at`,
          [String(account.id), keyHash, prefix, label],
        );
        inserted = result.rows[0]!;
      } catch (err) {
        // Trigger raises check_violation when the account already has 2 active
        // keys (spec §2 #21). Surface as 409 with a clear message — generic
        // 500 would be misleading.
        const code = (err as { code?: string }).code;
        if (code === '23514') {
          return reply.code(409).send({
            error: 'account already has the maximum of 2 active API keys',
          });
        }
        throw err;
      }

      // Spec §2 #22 — log the creation event with the key MASKED. The custom
      // pino formatter in logger.ts replaces api_key field values with
      // `***<last4>`, so passing the raw key here is safe (it never reaches
      // the wire). Logging the masked form gives operators a way to correlate
      // a user's "I lost my key" support ticket with the create event.
      req.log.info(
        { event: 'api_key.created', account_id: String(account.id), api_key: rawKey },
        'api_key.created',
      );

      const body = rowToApiResponse(inserted);
      return reply.code(201).send({
        ...body,
        key: rawKey,
        warning:
          'Save this key now — it will not be shown again. ' +
          'Store it in your secrets manager and treat it like a password.',
      });
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/api-keys/:id — soft-revoke (set revoked_at = now()).
  //   Returns 404 (not 403) when the row exists but belongs to another
  //   account — spec §2 #20 forbids existence leaks.
  // ---------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/api/api-keys/:id',
    { preHandler: [sessionMiddleware] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const account = req.account!;

      // Validate id is a positive integer (the column is int8 generated identity).
      const idStr = req.params.id;
      if (!/^[1-9]\d*$/.test(idStr)) {
        return reply.code(404).send({ error: 'not found' });
      }

      // Soft-revoke ONLY when the row belongs to the caller. UPDATE … RETURNING
      // gives us a single round trip that distinguishes "no such row in scope"
      // from "row revoked".
      const result = await pool.query<{ id: string; revoked_at: Date }>(
        `UPDATE api_keys
            SET revoked_at = now()
          WHERE id = $1
            AND account_id = $2
            AND revoked_at IS NULL
        RETURNING id::text, revoked_at`,
        [idStr, String(account.id)],
      );

      if (result.rows.length === 0) {
        // Either: (a) row doesn't exist at all, (b) belongs to another account,
        // or (c) was already revoked. In all three cases return 404 — we don't
        // want to disclose ownership or prior state.
        //
        // Edge case: if the caller already revoked their own key and clicks
        // again, returning 404 is acceptable UX (the row no longer appears as
        // "active" in the UI, which is the user's mental model).
        return reply.code(404).send({ error: 'not found' });
      }

      req.log.info(
        {
          event: 'api_key.revoked',
          account_id: String(account.id),
          api_key_id: result.rows[0]!.id,
        },
        'api_key.revoked',
      );

      return reply.code(200).send({
        id: Number(result.rows[0]!.id),
        revoked_at: result.rows[0]!.revoked_at.toISOString(),
      });
    },
  );

  // Avoid "unused" warnings if maskKey is wired in elsewhere later — exporting
  // is the cleaner long-term fix but this module currently only logs the
  // masked key implicitly via the pino formatter (logger.ts).
  void maskKey;
}
