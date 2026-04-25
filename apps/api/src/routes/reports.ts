/**
 * routes/reports.ts — GET /reports/:slug (issue #30).
 *
 * Spec refs: §2 #20 (private-by-default), §5.12 (share-token leak path).
 *
 * Public if reports.public = true AND expires_at not passed.
 * Otherwise requires ?t=<token>; validates via timingSafeEqual against
 * reports.share_token_hash (SHA-256 of the raw token).
 *
 * Returns 410 if expired, 404 if slug not found or token invalid.
 *
 * NOTE: The full §5.12 cookie-swap redirect (token → HttpOnly cookie) is
 * OUT OF SCOPE per issue #30. This endpoint returns the body directly.
 * The cookie redirect is a future follow-up PR.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

function sha256hex(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Timing-safe comparison of a raw share token against a stored hex hash.
 * Both sides are hashed to the same length before comparison.
 */
function tokenMatchesHash(rawToken: string, storedHexHash: string): boolean {
  const candidateHash = sha256hex(rawToken);
  // Both are hex strings of the same length — direct timingSafeEqual.
  const a = Buffer.from(candidateHash, 'utf8');
  const b = Buffer.from(storedHexHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function registerReportsRoutes(
  app: FastifyInstance,
  pool: Pool,
): Promise<void> {
  type GetReportRequest = FastifyRequest<{ Params: { slug: string }; Querystring: { t?: string } }>;
  // GET /reports/:slug
  // In v0.1 the slug is the study_id (numeric). The aggregator sets the
  // share_token_hash on the report row; full slug generation is Sprint 3.
  app.get<{ Params: { slug: string }; Querystring: { t?: string } }>(
    '/reports/:slug',
    async (req: GetReportRequest, reply: FastifyReply) => {
      const { slug } = req.params;
      const rawToken = req.query.t;

      const reportResult = await pool.query<{
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
      }>(
        `SELECT r.id, r.study_id, r.share_token_hash, r.public,
                r.expires_at, r.conv_score, r.paired_delta_json,
                r.clusters_json, r.scores_json,
                r.paired_tests_disagreement, r.ready_at
           FROM reports r
           JOIN studies s ON s.id = r.study_id
          WHERE r.study_id = $1`,
        [slug],
      );

      const report = reportResult.rows[0];
      if (!report) {
        return reply.code(404).send({ error: 'report not found' });
      }

      // Check expiry first (410 regardless of token).
      if (report.expires_at && report.expires_at <= new Date()) {
        return reply.code(410).send({ error: 'report expired' });
      }

      // Public reports need no token.
      const isPublic = report.public;
      if (!isPublic) {
        // Require a valid token.
        if (!rawToken) {
          return reply.code(404).send({ error: 'report not found' });
        }
        if (!tokenMatchesHash(rawToken, report.share_token_hash)) {
          return reply.code(404).send({ error: 'report not found' });
        }
      }

      // Per spec §2 #20: every token-bearing response is no-store.
      if (rawToken) {
        void reply.header('Cache-Control', 'no-store');
        void reply.header('Referrer-Policy', 'no-referrer');
      }

      return reply.code(200).send({
        study_id: Number(report.study_id),
        conv_score: parseFloat(report.conv_score),
        paired_delta_json: report.paired_delta_json,
        clusters_json: report.clusters_json,
        scores_json: report.scores_json,
        paired_tests_disagreement: report.paired_tests_disagreement,
        ready_at: report.ready_at.toISOString(),
      });
    },
  );
}
