/**
 * api-key.ts — Fastify preHandler middleware for API key authentication.
 *
 * Spec §2 #21, §5.8: reads Authorization: Bearer <token>, computes
 * sha256(token) and looks up api_keys.key_hash. 401 if no match or revoked.
 * Sets req.account on success for downstream route handlers.
 *
 * The raw key is never persisted; only the sha256 hex hash is stored
 * (infra/migrations/0001_accounts_and_keys.sql comment on key_hash column).
 */

import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

export interface AccountInfo {
  id: bigint;
  owner_email: string;
  verified_domains: string[];
}

// Augment Fastify's request type so downstream routes can read req.account.
declare module 'fastify' {
  interface FastifyRequest {
    account?: AccountInfo;
  }
}

function sha256hex(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Build a Fastify preHandler that validates the API key and populates
 * req.account. Returns 401 when the key is missing, invalid, or revoked.
 */
export function buildApiKeyMiddleware(pool: Pool) {
  return async function apiKeyMiddleware(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await reply.code(401).send({ error: 'missing or malformed Authorization header' });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      await reply.code(401).send({ error: 'empty API key' });
      return;
    }

    const keyHash = sha256hex(token);

    const result = await pool.query<{
      account_id: string;
      owner_email: string;
      verified_domains: string[];
    }>(
      `SELECT k.account_id, a.owner_email, a.verified_domains
         FROM api_keys k
         JOIN accounts a ON a.id = k.account_id
        WHERE k.key_hash = $1
          AND k.revoked_at IS NULL`,
      [keyHash],
    );

    const row = result.rows[0];
    if (!row) {
      await reply.code(401).send({ error: 'invalid or revoked API key' });
      return;
    }

    req.account = {
      id: BigInt(row.account_id),
      owner_email: row.owner_email,
      verified_domains: row.verified_domains ?? [],
    };
  };
}
