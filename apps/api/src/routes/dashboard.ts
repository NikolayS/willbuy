/**
 * routes/dashboard.ts — GET /api/dashboard/summary (issue #80).
 *
 * Spec refs:
 *   §3      — user stories: balance, recent studies, buy credits CTA.
 *   §5.10   — auth via wb_session HttpOnly HMAC cookie (issue #79 / PR #95).
 *   §5.4    — credit_ledger / account_balance view.
 *   §2 #1   — caller sees ONLY their own studies (account scoping).
 *
 * Design note (rev-pr95 N1): the shared session middleware in
 * apps/api/src/auth/session.ts is strict — it 401s on missing or invalid
 * cookies. That's the desired behaviour for /api/dashboard/* (a JSON API
 * surface scoped to authenticated users). The web layer turns the 401 into
 * a 302 redirect to /sign-in (apps/web/app/dashboard/page.tsx).
 *
 * Returned shape:
 *   {
 *     email:          string,
 *     balance_cents:  int,        // 0 if no ledger rows yet
 *     recent_studies: Array<{
 *       id:         number,
 *       status:     'pending'|'capturing'|'visiting'|'aggregating'|'ready'|'failed',
 *       created_at: ISO-8601 string,
 *       n_visits:   number,       // count of backstories for the study
 *       urls:       string[]      // 1 or 2 entries (single | paired)
 *     }>
 *   }
 *
 * Last 10 studies, ORDER BY created_at DESC, scoped to req.account.id.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { buildSessionMiddleware } from '../auth/session.js';
import type { Env } from '../env.js';

interface StudyRow {
  id: string;
  status: string;
  created_at: Date;
  urls: string[] | null;
  n_visits: string;
}

export async function registerDashboardRoutes(
  app: FastifyInstance,
  pool: Pool,
  env: Env,
): Promise<void> {
  const sessionMiddleware = buildSessionMiddleware(env.SESSION_HMAC_KEY, env.NODE_ENV);

  app.get(
    '/api/dashboard/summary',
    { preHandler: [sessionMiddleware] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      // sessionMiddleware guarantees req.account is populated; if it isn't,
      // the middleware has already 401'd and we don't reach here.
      const account = req.account!;

      // Balance via account_balance view (sum of credit_ledger.cents).
      // Returns 0 rows if account has no ledger entries yet — coalesce.
      const balanceResult = await pool.query<{ balance_cents: string | null }>(
        `SELECT balance_cents FROM account_balance WHERE account_id = $1`,
        [String(account.id)],
      );
      const balanceCents = Number(balanceResult.rows[0]?.balance_cents ?? 0);

      // Recent studies: last 10 DESC by created_at. Join backstories count for
      // n_visits (the persisted N from issue #34 / PR #72). LEFT JOIN keeps
      // pre-#34 studies (no backstory rows) showing n_visits=0.
      const studiesResult = await pool.query<StudyRow>(
        `SELECT s.id,
                s.status,
                s.created_at,
                s.urls,
                COUNT(b.id)::text AS n_visits
           FROM studies s
           LEFT JOIN backstories b ON b.study_id = s.id
          WHERE s.account_id = $1
          GROUP BY s.id, s.status, s.created_at, s.urls
          ORDER BY s.created_at DESC
          LIMIT 10`,
        [String(account.id)],
      );

      const recent_studies = studiesResult.rows.map((r) => ({
        id: Number(r.id),
        status: r.status,
        created_at: r.created_at.toISOString(),
        n_visits: Number(r.n_visits),
        urls: r.urls ?? [],
      }));

      return reply.code(200).send({
        email: account.owner_email,
        balance_cents: balanceCents,
        recent_studies,
      });
    },
  );
}
