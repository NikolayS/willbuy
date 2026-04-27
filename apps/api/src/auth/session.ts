/**
 * auth/session.ts — wb_session cookie middleware (issue #79).
 *
 * Spec refs: §5.10 (cookie flags), §2 #20 (no existence leak).
 *
 * Cookie name: `wb_session` in dev/test; `__Host-wb_session` in production
 * (the __Host- prefix mandates Secure + Path=/ + no Domain= per RFC 6265bis).
 *
 * Payload: JSON {account_id: string, expires_at: string (ISO)}
 * Signed with HMAC-SHA-256 using SESSION_HMAC_KEY.
 * Wire format: base64url(payload) + '.' + base64url(hmac)
 *
 * This middleware is a SIBLING to api-key.ts — it does NOT replace it.
 * If wb_session is valid it populates req.account; if not, the request
 * falls through to api-key validation or returns 401 depending on the route.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AccountInfo } from './api-key.js';

export const COOKIE_NAME_PROD = '__Host-wb_session';
export const COOKIE_NAME_DEV = 'wb_session';

export function cookieName(env: string): string {
  return env === 'production' ? COOKIE_NAME_PROD : COOKIE_NAME_DEV;
}

export interface SessionPayload {
  account_id: string;
  owner_email: string;
  expires_at: string; // ISO-8601
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/**
 * Encode a session cookie value.
 * Format: <base64url-json>.<hmac-base64url>
 */
export function encodeSession(payload: SessionPayload, hmacKey: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = sign(encoded, hmacKey);
  return `${encoded}.${mac}`;
}

/**
 * Decode and verify a session cookie value.
 * Returns the payload or null if invalid/expired/tampered.
 */
export function decodeSession(
  cookieValue: string,
  hmacKey: string,
): SessionPayload | null {
  const dot = cookieValue.lastIndexOf('.');
  if (dot === -1) return null;

  const encoded = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);

  // Timing-safe MAC verification.
  const expectedMac = sign(encoded, hmacKey);
  const macBuf = Buffer.from(mac, 'base64url');
  const expectedBuf = Buffer.from(expectedMac, 'base64url');
  if (macBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(macBuf, expectedBuf)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }

  // Check expiry.
  if (new Date(payload.expires_at) <= new Date()) return null;

  return payload;
}

/**
 * Build a Fastify preHandler that reads the wb_session cookie and populates
 * req.account. Sends 401 if cookie is missing, invalid, or expired.
 *
 * When pool is provided, verified_domains is loaded from the DB so session
 * users get the same req.account shape as API-key-authenticated callers.
 * Without pool, verified_domains is [] (sufficient for read-only routes).
 *
 * Usage: mount on /dashboard/* and /api/dashboard/* routes.
 */
export function buildSessionMiddleware(hmacKey: string, nodeEnv: string, pool?: Pool) {
  const name = cookieName(nodeEnv);

  return async function sessionMiddleware(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Cookie header must be parsed manually (no cookie plugin registered).
    const cookieHeader = req.headers.cookie ?? '';
    const cookieValue = parseCookie(cookieHeader, name);

    if (!cookieValue) {
      await reply.code(401).send({ error: 'authentication required' });
      return;
    }

    const payload = decodeSession(cookieValue, hmacKey);
    if (!payload) {
      await reply.code(401).send({ error: 'invalid or expired session' });
      return;
    }

    let verified_domains: string[] = [];
    if (pool) {
      const result = await pool.query<{ verified_domains: string[] | null }>(
        `SELECT verified_domains FROM accounts WHERE id = $1`,
        [payload.account_id],
      );
      verified_domains = result.rows[0]?.verified_domains ?? [];
    }

    req.account = {
      id: BigInt(payload.account_id),
      owner_email: payload.owner_email,
      verified_domains,
    } satisfies AccountInfo;
  };
}

/**
 * Parse a single cookie value from a Cookie header string.
 * Returns undefined if the cookie is not present.
 */
export function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

/**
 * Build the Set-Cookie header value for wb_session.
 */
export function buildSetCookieHeader(
  value: string,
  nodeEnv: string,
  maxAgeSeconds: number,
): string {
  const name = cookieName(nodeEnv);
  const secure = nodeEnv === 'production' ? '; Secure' : '';
  // __Host- prefix forbids Domain= attribute in all envs
  return `${name}=${value}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

/**
 * Build a cookie-clearing Set-Cookie header.
 */
export function buildClearCookieHeader(nodeEnv: string): string {
  const name = cookieName(nodeEnv);
  const secure = nodeEnv === 'production' ? '; Secure' : '';
  return `${name}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}
