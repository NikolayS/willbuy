/**
 * routes/domains.ts — domain verification flow (issue #82, Sprint 3 Auth #2).
 *
 * Spec ref: §2 #1 (verified-domain authorization, v0.1).
 *
 * Routes (all require a valid wb_session cookie):
 *
 *   POST /api/domains
 *     Body: { domain: string }   (eTLD+1; validated via tldts)
 *     Returns: { domain, verify_token, methods: { dns, well_known, meta } }
 *     Effect: upsert (account_id, domain) → fresh 22-char nanoid verify_token.
 *
 *   POST /api/domains/:domain/verify
 *     Probes ALL three v0.1 verification methods in parallel:
 *       1. node:dns/promises.resolveTxt(domain) — looking for
 *          'willbuy-verify=<token>' in any returned chunk.
 *       2. fetch('http://<domain>/.well-known/willbuy-verify') — body equals
 *          the token (whitespace-trimmed).
 *       3. fetch('http://<domain>/') — body contains
 *          <meta name="willbuy-verify" content="<token>">.
 *     Each probe has a strict 5s timeout (Promise.race against AbortSignal).
 *     On first match: marks verified_at, atomically appends domain to
 *     accounts.verified_domains, returns { verified: true, method }.
 *     On no match: updates last_checked_at, returns { verified: false }.
 *
 *   GET /api/domains                       — issue #83, list page.
 *     Returns: { domains: [{ domain, verify_token, verified_at,
 *                            last_checked_at, created_at }] }
 *     Order: created_at DESC. Scoped to req.account.id.
 *
 *   DELETE /api/domains/:domain            — issue #83, list page.
 *     Removes the row from domain_verifications AND drops the value from
 *     accounts.verified_domains[] in a single transaction.
 *     204 on success; 404 if the (account, domain) pair has no row
 *     (looks identical for "doesn't exist" and "owned by another account"
 *     to avoid leaking existence — spec §2 #20).
 *
 *   POST /api/domains/:domain/delete       — CSP-safe form workaround.
 *     Browsers can only emit GET/POST from <form>; the dashboard runs
 *     under a strict CSP (no inline JS), so a literal DELETE button via
 *     fetch() is not an option for the no-JS list page. This route
 *     performs the same SQL as DELETE and 302-redirects back to
 *     /dashboard/domains so the user lands on a refreshed list.
 *
 * Design notes:
 *   - The token is a 22-char nanoid (≈131 bits of entropy) — same length as
 *     the magic-link token in routes/auth.ts. Cleartext storage is fine here:
 *     the token is meant to be published by the user.
 *   - Probes are stubbable via __test_setProbes() so the integration test
 *     can drive each method without depending on real DNS/HTTP. The setter
 *     is NODE_ENV-gated (no-op outside 'test') — see issue #104 N1 and the
 *     WILLBUY_DEV_SESSION pattern in routes/auth.ts.
 *   - HTTPS-only (issue #104 SEC-1): probeWellKnown and probeMeta both use
 *     https:// exclusively. There is NO http:// fallback. An active
 *     network attacker on the http leg can mint a fake "verified" status;
 *     domains without TLS must use the DNS TXT method, which is not
 *     vulnerable to in-path HTTP injection in the same way.
 *   - Redirect policy (issue #104 SEC-2): BOTH http probes use
 *     redirect: 'manual' and treat any 3xx as a probe failure. The
 *     verification target document — the well-known file or the root
 *     page's <meta> — MUST be served directly from the requested origin.
 *     An attacker who can mint a redirect (e.g. via a hijacked path or a
 *     path-handling bug) must not be allowed to leak a verified status
 *     by serving the token from a foreign eTLD+1.
 *   - Cross-account constraint: the route only operates on the
 *     (req.account.id, domain) pair, so two different accounts can each
 *     verify the same domain independently. accounts.verified_domains is
 *     scoped per-account.
 */

import { promises as dns } from 'node:dns';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import type { Pool } from 'pg';
import tldts from 'tldts';
import { z } from 'zod';

import type { Env } from '../env.js';
import { buildSessionMiddleware } from '../auth/session.js';

// ─── Types for probe injection (test seam) ───────────────────────────────────

type ResolveTxtFn = (domain: string) => Promise<string[][]>;
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// Default probe implementations (real network).
const DEFAULT_RESOLVE_TXT: ResolveTxtFn = (d) => dns.resolveTxt(d);
const DEFAULT_FETCH: FetchFn = (url, init) => fetch(url, init);

// Mutable holders so tests can inject mocks without re-importing the module.
// __test_setProbes() / __test_resetProbes() in the test file.
let _resolveTxt: ResolveTxtFn = DEFAULT_RESOLVE_TXT;
let _fetch: FetchFn = DEFAULT_FETCH;

/**
 * Test-only seam: inject mock resolveTxt / fetch implementations.
 *
 * NODE_ENV-gated (issue #104 N1): in any non-'test' environment this is a
 * no-op. The export remains so test files can import it unconditionally,
 * but a misuse in production cannot mint a fake "verified" status by
 * swapping in a permissive probe. Mirrors the WILLBUY_DEV_SESSION pattern
 * in routes/auth.ts.
 */
export function __test_setProbes(opts: {
  resolveTxt?: ResolveTxtFn;
  fetch?: FetchFn;
}): void {
  if (process.env.NODE_ENV !== 'test') return;
  if (opts.resolveTxt) _resolveTxt = opts.resolveTxt;
  if (opts.fetch) _fetch = opts.fetch;
}

/** Test-only seam: restore default probes. NODE_ENV-gated, like setProbes. */
export function __test_resetProbes(): void {
  if (process.env.NODE_ENV !== 'test') return;
  _resolveTxt = DEFAULT_RESOLVE_TXT;
  _fetch = DEFAULT_FETCH;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 5000;
const TOKEN_LENGTH = 22;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const CreateDomainBody = z.object({
  domain: z.string().min(1).max(253),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Validate + normalize an input string to its eTLD+1, or null on failure. */
function normalizeEtldPlusOne(input: string): string | null {
  // Reject obvious garbage (spaces, etc.) up front; tldts will accept some
  // surprising things otherwise.
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  if (/\s/.test(trimmed)) return null;
  // tldts accepts URLs and bare hostnames; getDomain returns the eTLD+1.
  const domain = tldts.getDomain(trimmed);
  if (!domain) return null;
  // Guard: tldts.getDomain can return e.g. 'localhost' for 'localhost' which
  // isn't a public-suffix-anchored domain. Insist on at least one dot.
  if (!domain.includes('.')) return null;
  return domain;
}

/** Wrap a promise with a timeout. Resolves to null on timeout or rejection. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<null>((res) => {
    timer = setTimeout(() => res(null), ms);
  });
  try {
    const out = await Promise.race([
      p.then((v) => v).catch(() => null),
      timeout,
    ]);
    return out as T | null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Probe implementations ───────────────────────────────────────────────────

async function probeDns(domain: string, token: string): Promise<boolean> {
  const expected = `willbuy-verify=${token}`;
  const result = await withTimeout(_resolveTxt(domain), PROBE_TIMEOUT_MS);
  if (!result) return false;
  for (const chunks of result) {
    // TXT records can be returned as a single chunk per record OR as multiple
    // 255-byte chunks that must be joined. Check both forms.
    const joined = chunks.join('');
    if (joined === expected) return true;
    if (chunks.includes(expected)) return true;
  }
  return false;
}

/**
 * HTTPS-only fetch with per-attempt 5s abort timeout.
 *
 * Returns the Response on a 2xx, or null on:
 *   - non-2xx (including any 3xx — see redirect policy below)
 *   - network/timeout errors
 *
 * Redirect policy (issue #104 SEC-2): both probes call this with
 * redirect: 'manual'. A 3xx response has res.ok === false, so it is
 * treated as a probe failure and the route does NOT read or scan the
 * body. This prevents a redirect-to-attacker (foreign eTLD+1) from
 * leaking a verified status.
 *
 * HTTPS-only (issue #104 SEC-1): the URL is required to be https://;
 * there is no http:// fallback. Domains without TLS must use the DNS
 * TXT method.
 */
async function httpsProbeFetch(
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  if (!url.startsWith('https://')) {
    // Defense-in-depth — callers below construct https:// URLs literally,
    // but we re-check here so a future refactor cannot accidentally
    // re-introduce an http:// path.
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await _fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function probeWellKnown(domain: string, token: string): Promise<boolean> {
  // HTTPS-only; well-known probe requires HTTPS. See issue #104 SEC-1.
  // redirect: 'manual' — well-known file must be served directly from
  // origin; a 3xx (e.g. redirect to attacker eTLD+1) is rejected. See
  // issue #104 SEC-2.
  const url = `https://${domain}/.well-known/willbuy-verify`;
  const res = await withTimeout(
    httpsProbeFetch(url, { redirect: 'manual' }),
    PROBE_TIMEOUT_MS,
  );
  if (!res) return false;
  const body = await withTimeout(res.text(), PROBE_TIMEOUT_MS);
  if (!body) return false;
  return body.trim() === token;
}

async function probeMeta(domain: string, token: string): Promise<boolean> {
  // HTTPS-only; meta probe requires HTTPS. See issue #104 SEC-1.
  // redirect: 'manual' — the meta tag must be served directly from the
  // requested origin (matches probeWellKnown). A 3xx — even one whose
  // body would have contained the token, e.g. via a foreign eTLD+1 —
  // is treated as a probe failure. See issue #104 SEC-2.
  const url = `https://${domain}/`;
  const res = await withTimeout(
    httpsProbeFetch(url, { redirect: 'manual' }),
    PROBE_TIMEOUT_MS,
  );
  if (!res) return false;
  const body = await withTimeout(res.text(), PROBE_TIMEOUT_MS);
  if (!body) return false;
  // Match either single or double quotes, with attribute order flexibility.
  // willbuy-verify is the only meta name we care about.
  const re = new RegExp(
    `<meta\\s+[^>]*name=["']willbuy-verify["'][^>]*content=["']${escapeRegExp(token)}["']`,
    'i',
  );
  if (re.test(body)) return true;
  // Also accept reversed attribute order.
  const reReverse = new RegExp(
    `<meta\\s+[^>]*content=["']${escapeRegExp(token)}["'][^>]*name=["']willbuy-verify["']`,
    'i',
  );
  return reReverse.test(body);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Route registration ──────────────────────────────────────────────────────

export async function registerDomainsRoutes(
  app: FastifyInstance,
  pool: Pool,
  env: Env,
): Promise<void> {
  const sessionMw = buildSessionMiddleware(env.SESSION_HMAC_KEY, env.NODE_ENV);

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/domains — request a verification challenge for <domain>.
  // ──────────────────────────────────────────────────────────────────────────
  app.post(
    '/api/domains',
    { preHandler: [sessionMw] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const account = req.account!;

      const parsed = CreateDomainBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const domain = normalizeEtldPlusOne(parsed.data.domain);
      if (!domain) {
        return reply.code(400).send({ error: 'invalid domain (must be a public eTLD+1)' });
      }

      const verifyToken = nanoid(TOKEN_LENGTH);

      // Upsert: rotate verify_token + reset state on conflict.
      await pool.query(
        `INSERT INTO domain_verifications (account_id, domain, verify_token)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT domain_verifications_account_domain_uniq
           DO UPDATE SET
             verify_token = EXCLUDED.verify_token,
             verified_at = NULL,
             last_checked_at = NULL`,
        [String(account.id), domain, verifyToken],
      );

      return reply.code(200).send({
        domain,
        verify_token: verifyToken,
        methods: {
          dns: `TXT willbuy-verify=${verifyToken}`,
          well_known: `GET /.well-known/willbuy-verify returns ${verifyToken}`,
          meta: `<meta name="willbuy-verify" content="${verifyToken}">`,
        },
      });
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/domains/:domain/verify — probe & mark verified on first match.
  // ──────────────────────────────────────────────────────────────────────────
  app.post<{ Params: { domain: string } }>(
    '/api/domains/:domain/verify',
    { preHandler: [sessionMw] },
    async (req, reply) => {
      const account = req.account!;
      const rawDomain = req.params.domain;
      const domain = normalizeEtldPlusOne(rawDomain);
      if (!domain) {
        return reply.code(400).send({ error: 'invalid domain' });
      }

      // Look up the challenge row.
      const r = await pool.query<{
        id: string;
        verify_token: string;
        verified_at: Date | null;
      }>(
        `SELECT id, verify_token, verified_at
           FROM domain_verifications
          WHERE account_id = $1 AND domain = $2`,
        [String(account.id), domain],
      );
      const row = r.rows[0];
      if (!row) {
        return reply.code(404).send({ error: 'no verification challenge for this domain' });
      }

      const token = row.verify_token;

      // Probe all three methods in parallel. Return on first success.
      // We deliberately let all three settle to update last_checked_at on
      // failure paths consistently. The method priority is dns > well_known > meta.
      const [dnsHit, wkHit, metaHit] = await Promise.all([
        probeDns(domain, token).catch(() => false),
        probeWellKnown(domain, token).catch(() => false),
        probeMeta(domain, token).catch(() => false),
      ]);

      let method: 'dns' | 'well_known' | 'meta' | null = null;
      if (dnsHit) method = 'dns';
      else if (wkHit) method = 'well_known';
      else if (metaHit) method = 'meta';

      if (method !== null) {
        // Mark verified + atomically append to accounts.verified_domains.
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE domain_verifications
                SET verified_at = now(),
                    last_checked_at = now()
              WHERE id = $1`,
            [row.id],
          );
          // array_append + dedupe: only append if not already present.
          await client.query(
            `UPDATE accounts
                SET verified_domains =
                  CASE
                    WHEN $2 = ANY(COALESCE(verified_domains, '{}')) THEN verified_domains
                    ELSE COALESCE(verified_domains, '{}') || ARRAY[$2]::text[]
                  END
              WHERE id = $1`,
            [String(account.id), domain],
          );
          await client.query('COMMIT');
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch { /* ignore */ }
          throw err;
        } finally {
          client.release();
        }
        return reply.code(200).send({ verified: true, method });
      }

      // Failure: just bump last_checked_at.
      await pool.query(
        `UPDATE domain_verifications SET last_checked_at = now() WHERE id = $1`,
        [row.id],
      );
      return reply.code(200).send({ verified: false });
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/domains — list domains for the authenticated account (issue #83).
  // ──────────────────────────────────────────────────────────────────────────
  app.get(
    '/api/domains',
    { preHandler: [sessionMw] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const account = req.account!;
      const r = await pool.query<{
        domain: string;
        verify_token: string;
        verified_at: Date | null;
        last_checked_at: Date | null;
        created_at: Date;
      }>(
        `SELECT domain, verify_token, verified_at, last_checked_at, created_at
           FROM domain_verifications
          WHERE account_id = $1
          ORDER BY created_at DESC, id DESC`,
        [String(account.id)],
      );
      return reply.code(200).send({
        domains: r.rows.map((row) => ({
          domain: row.domain,
          verify_token: row.verify_token,
          verified_at: row.verified_at?.toISOString() ?? null,
          last_checked_at: row.last_checked_at?.toISOString() ?? null,
          created_at: row.created_at.toISOString(),
        })),
      });
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // DELETE /api/domains/:domain — remove a (account, domain) pair (issue #83).
  //
  // Atomic: drops the verification row AND removes the value from
  // accounts.verified_domains[] in a single transaction so the list view
  // can never show a "phantom" verified domain that's missing its challenge
  // record (or vice-versa).
  // ──────────────────────────────────────────────────────────────────────────
  async function deleteDomainForAccount(
    accountId: string,
    domain: string,
  ): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Use RETURNING to confirm the row was actually owned by this account.
      // If 0 rows are deleted, the (account, domain) pair didn't exist or
      // belonged to a different account — caller treats both as 404.
      const del = await client.query(
        `DELETE FROM domain_verifications
          WHERE account_id = $1 AND domain = $2
          RETURNING id`,
        [accountId, domain],
      );
      if (del.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      // array_remove drops every occurrence of the value (NULL-safe).
      await client.query(
        `UPDATE accounts
            SET verified_domains = array_remove(COALESCE(verified_domains, '{}'), $2)
          WHERE id = $1`,
        [accountId, domain],
      );

      await client.query('COMMIT');
      return true;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  app.delete<{ Params: { domain: string } }>(
    '/api/domains/:domain',
    { preHandler: [sessionMw] },
    async (req, reply) => {
      const account = req.account!;
      const domain = normalizeEtldPlusOne(req.params.domain);
      if (!domain) {
        // Treat malformed domain identical to non-existent — same 404 shape.
        return reply.code(404).send({ error: 'not found' });
      }

      const ok = await deleteDomainForAccount(String(account.id), domain);
      if (!ok) {
        return reply.code(404).send({ error: 'not found' });
      }
      // 204 No Content per HTTP semantics; no body.
      return reply.code(204).send();
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/domains/:domain/delete — form-submit fallback (issue #83).
  //
  // The /dashboard/domains list runs under a strict CSP (§5.10) and uses
  // native HTML <form> posts instead of fetch() for the action buttons.
  // Because forms can only emit GET or POST, this sibling route does the
  // same work as DELETE and redirects back to the list page.
  // ──────────────────────────────────────────────────────────────────────────
  app.post<{ Params: { domain: string } }>(
    '/api/domains/:domain/delete',
    { preHandler: [sessionMw] },
    async (req, reply) => {
      const account = req.account!;
      const domain = normalizeEtldPlusOne(req.params.domain);
      if (!domain) {
        return reply.code(404).send({ error: 'not found' });
      }
      // Best-effort delete: even if the row didn't exist, redirect back to
      // the list. Any leak is bounded to "is this domain in your list" —
      // which the user already sees on the page they came from.
      await deleteDomainForAccount(String(account.id), domain);
      return reply.code(302).redirect('/dashboard/domains');
    },
  );
}

// Test-only export: normalizeEtldPlusOne is the domain validation boundary
// used by every write route. Exposing it here lets unit tests verify the
// tldts-backed allow/deny logic without spinning up Fastify + Postgres.
export const __test__ = { normalizeEtldPlusOne };
