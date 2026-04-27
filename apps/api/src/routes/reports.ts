/**
 * routes/reports.ts — GET /reports/:slug (issue #30, §5.12 issue #76).
 *
 * Spec refs: §2 #20 (private-by-default), §5.12 (share-token leak path).
 *
 * §5.12 cookie-swap redirect (issue #76):
 *
 * 1. If ?t=<token> present:
 *    - Look up share_tokens row by report_slug + timing-safe hash compare.
 *    - Reject (404) if invalid, revoked, or expired.
 *    - On valid: set HttpOnly scoped cookie (HMAC-signed opaque value), 302
 *      redirect to /r/<slug> with Cache-Control: no-store.
 *
 * 2. Else if cookie wb_rt_<slug> present:
 *    - Verify HMAC. On invalid: 404.
 *    - Re-check DB (revoked_at / expires_at). On stale: 404.
 *    - On valid: 200 with report body + Cache-Control: no-store.
 *
 * 3. Else:
 *    - If reports.public = true AND not expired: 200.
 *    - Otherwise: 404.
 *
 * Returns 404 for all invalid/expired/missing cases (§2 #20 — no existence leak).
 *
 * NOTE: Set-Cookie uses manual reply.header() — @fastify/cookie is not required
 * for HttpOnly cookies set by the server (only needed if reading cookies via
 * req.cookies shorthand). We parse the incoming cookie header manually.
 *
 * Two-tier TTL (Sprint 3 retro F2, spec §2 #20):
 *  - The underlying SHARE TOKEN row in DB has a long expiry (default 90 days)
 *    so revocation/rotation flows make sense and links remain shareable.
 *  - The BROWSER COOKIE issued after the cookie-swap is capped at 2 hours.
 *    After that, the browser drops the cookie and the user must re-present
 *    the original `?t=<token>` URL (which is still valid in DB) to get a
 *    fresh 2-hour cookie. This limits the blast radius of a stolen browser
 *    profile / sticky session and matches §2 #20's "2-hour session TTL".
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

// Spec §2 #20: cookie has a 2-hour session TTL regardless of the underlying
// share-token row's `expires_at` (which may be up to 90 days). See file-level
// "Two-tier TTL" note above. Sprint 3 retro audit finding F2.
const MAX_COOKIE_SECONDS = 2 * 60 * 60; // 2 hours per spec §2 #20

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function sha256hex(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Timing-safe comparison of a raw share token against a stored hex hash.
 * Both sides are hashed to the same length before comparison.
 */
function tokenMatchesHash(rawToken: string, storedHexHash: string): boolean {
  const candidateHash = sha256hex(rawToken);
  const a = Buffer.from(candidateHash, 'utf8');
  const b = Buffer.from(storedHexHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Build an opaque HMAC-signed cookie value.
 *
 * Format: `<slug>:<expiresAtISO>:<accountId>.<hmac-hex>`
 *
 * The payload includes slug + expiresAt + accountId so the cookie cannot
 * be reused across slugs or after expiry without re-issuing.
 */
function buildCookieValue(
  slug: string,
  expiresAt: Date,
  accountId: string,
  hmacKey: string,
): string {
  const payload = `${slug}:${expiresAt.toISOString()}:${accountId}`;
  const sig = createHmac('sha256', hmacKey).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/**
 * Verify a cookie value and return the parsed payload if valid.
 * Returns null on any failure (wrong HMAC, malformed, etc.).
 */
function verifyCookieValue(
  cookieValue: string,
  expectedSlug: string,
  hmacKey: string,
): { slug: string; expiresAt: Date; accountId: string } | null {
  const dotIdx = cookieValue.lastIndexOf('.');
  if (dotIdx < 0) return null;

  const payload = cookieValue.slice(0, dotIdx);
  const suppliedSig = cookieValue.slice(dotIdx + 1);
  const expectedSig = createHmac('sha256', hmacKey).update(payload).digest('hex');

  // Timing-safe comparison of hex signatures.
  const aBuf = Buffer.from(suppliedSig, 'utf8');
  const bBuf = Buffer.from(expectedSig, 'utf8');
  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) return null;

  // Parse payload: <slug>:<expiresAtISO>:<accountId>
  // ISO 8601 dates look like "2026-07-24T12:00:00.000Z" — no extra colons.
  // Format: slug:expiresAt:accountId
  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const slug = parts[0]!;
  // accountId is the last segment; expiresAt is everything in between.
  const accountId = parts[parts.length - 1]!;
  const expiresAtStr = parts.slice(1, parts.length - 1).join(':');
  const expiresAt = new Date(expiresAtStr);

  if (isNaN(expiresAt.getTime())) return null;
  if (slug !== expectedSlug) return null;

  return { slug, expiresAt, accountId };
}

/**
 * Parse a single named cookie from a raw Cookie header string.
 * Returns the cookie value or undefined.
 */
function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  // Cookie header format: "name=value; name2=value2; ..."
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === name) return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Route types
// ---------------------------------------------------------------------------

type GetReportRequest = FastifyRequest<{
  Params: { slug: string };
  Querystring: { t?: string };
}>;

interface ShareTokenRow {
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  account_id: string;
}

interface ReportRow {
  id: string;
  study_id: string;
  share_token_hash: string;
  public: boolean;
  expires_at: Date | null;
  conv_score: string;
  paired_delta_json: object;
  clusters_json: object | null;
  scores_json: object | null;
  paired_tests_disagreement: boolean | null;
  ready_at: Date;
  report_json: unknown | null;
  urls: string[] | null;
}

// Test-only seam: exposes the crypto helpers for unit testing without
// spinning up a Fastify server + Postgres + real HMAC tokens.
export const __test__ = {
  buildCookieValue,
  verifyCookieValue,
  parseCookie,
  tokenMatchesHash,
  MAX_COOKIE_SECONDS,
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerReportsRoutes(
  app: FastifyInstance,
  pool: Pool,
  hmacKey: string,
): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { t?: string } }>(
    '/reports/:slug',
    async (req: GetReportRequest, reply: FastifyReply) => {
      const { slug } = req.params;
      const rawToken = req.query.t;

      // ------------------------------------------------------------------
      // Fetch the report row (needed in all paths).
      // ------------------------------------------------------------------
      const reportResult = await pool.query<ReportRow>(
        `SELECT r.id, r.study_id, r.share_token_hash, r.public,
                r.expires_at, r.conv_score, r.paired_delta_json,
                r.clusters_json, r.scores_json,
                r.paired_tests_disagreement, r.ready_at,
                r.report_json,
                s.urls
           FROM reports r
           JOIN studies s ON s.id = r.study_id
          WHERE r.study_id = $1`,
        [slug],
      );

      const report = reportResult.rows[0];
      if (!report) {
        return reply.code(404).send({ error: 'report not found' });
      }

      // §2 #20: expired reports → 404 (no existence leak).
      if (report.expires_at && report.expires_at <= new Date()) {
        return reply.code(404).send({ error: 'report not found' });
      }

      const send200 = () => {
        void reply.header('Cache-Control', 'no-store');
        void reply.header('Referrer-Policy', 'no-referrer');
        return reply.code(200).send({
          study_id: Number(report.study_id),
          conv_score: parseFloat(report.conv_score),
          paired_delta_json: report.paired_delta_json,
          clusters_json: report.clusters_json,
          scores_json: report.scores_json,
          paired_tests_disagreement: report.paired_tests_disagreement,
          ready_at: report.ready_at.toISOString(),
          report_json: report.report_json ?? null,
          urls: report.urls ?? null,
        });
      };

      // ------------------------------------------------------------------
      // Path 1: ?t=<token> query parameter present.
      // ------------------------------------------------------------------
      if (rawToken) {
        // Fetch share_tokens row for this slug.
        const stResult = await pool.query<ShareTokenRow>(
          `SELECT token_hash, expires_at, revoked_at, account_id::text AS account_id
             FROM share_tokens
            WHERE report_slug = $1`,
          [slug],
        );

        const st = stResult.rows[0];

        // §2 #20: 404 if no share_tokens row or hash mismatch (timing-safe).
        if (!st || !tokenMatchesHash(rawToken, st.token_hash)) {
          return reply.code(404).send({ error: 'report not found' });
        }

        // §2 #20: revoked or expired → 404.
        if (st.revoked_at !== null || st.expires_at <= new Date()) {
          return reply.code(404).send({ error: 'report not found' });
        }

        // Token is valid — build HMAC cookie, set it, 302 redirect.
        // Spec §2 #20: cookie name is `wb_rt_<slug>` (Sprint 3 retro F1).
        const cookieValue = buildCookieValue(slug, st.expires_at, st.account_id, hmacKey);
        const cookieName = `wb_rt_${slug}`;
        // Spec §2 #20: cookie TTL is capped at 2h even if the underlying token
        // has a much longer DB expiry (default 90 days). Sprint 3 retro F2.
        // See file-level "Two-tier TTL" comment for rationale.
        const tokenSecondsRemaining = Math.max(
          0,
          Math.floor((st.expires_at.getTime() - Date.now()) / 1000),
        );
        const maxAgeSec = Math.min(tokenSecondsRemaining, MAX_COOKIE_SECONDS);

        void reply.header(
          'set-cookie',
          `${cookieName}=${cookieValue}; Path=/r/${slug}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`,
        );
        void reply.header('Cache-Control', 'no-store');
        void reply.header('Referrer-Policy', 'no-referrer');
        return reply.code(302).redirect(`/r/${slug}`);
      }

      // ------------------------------------------------------------------
      // Path 2: Cookie present.
      // Spec §2 #20: cookie name is `wb_rt_<slug>` (Sprint 3 retro F1).
      // ------------------------------------------------------------------
      const cookieName = `wb_rt_${slug}`;
      const cookieHeader = req.headers['cookie'] as string | undefined;
      const cookieValue = parseCookie(cookieHeader, cookieName);

      if (cookieValue !== undefined) {
        // Verify HMAC.
        const parsed = verifyCookieValue(cookieValue, slug, hmacKey);
        if (!parsed) {
          return reply.code(404).send({ error: 'report not found' });
        }

        // Re-check DB every time the cookie is presented (revoke propagation).
        const stResult = await pool.query<ShareTokenRow>(
          `SELECT token_hash, expires_at, revoked_at, account_id::text AS account_id
             FROM share_tokens
            WHERE report_slug = $1`,
          [slug],
        );

        const st = stResult.rows[0];
        if (!st || st.revoked_at !== null || st.expires_at <= new Date()) {
          return reply.code(404).send({ error: 'report not found' });
        }

        return send200();
      }

      // ------------------------------------------------------------------
      // Path 3: No token, no cookie — public path.
      // ------------------------------------------------------------------
      if (report.public) {
        return send200();
      }

      return reply.code(404).send({ error: 'report not found' });
    },
  );
}
