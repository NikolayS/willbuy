/**
 * routes/studies.ts — POST /studies + GET /studies/:id (issue #30).
 *
 * Spec refs: §5.1 (data flow), §2 #1 (verified-domain authorization),
 * §5.11 (study status transitions), §2 #18 (paired A/B = exactly 2 URLs).
 *
 * POST /studies:
 *   - Validates body with zod (urls 1..2, icp, n_visits 1..100).
 *   - Checks each URL's eTLD+1 is in account.verified_domains (§2 #1).
 *   - Reserves estimated spend: urls × N × 5¢ + 3¢ per spec §5.5 (§5.7 for algorithm overview).
 *   - Creates Study + N Backstory rows + visit queue rows in a transaction.
 *   - Returns 201 { study_id, status: 'capturing' }.
 *
 * GET /studies/:id:
 *   - Returns { id, status, visit_progress: {ok,failed,total}, started_at, finalized_at }.
 *   - 404 if not owned by req.account (no 403 leak per spec §2 #1).
 */

import tldts from 'tldts';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { buildApiKeyMiddleware } from '../auth/api-key.js';
import type { Env } from '../env.js';

// Per-visit estimated cost ceiling = 5¢ per spec §5.5 (cost-model ceiling).
// §5.7 (Algorithms) describes the broader cost-model overview.
const CENTS_PER_VISIT_EST = 5;
// Once-per-study cost for the cluster_label LLM call per spec §5.5.
const CENTS_PER_STUDY_CLUSTER_LABEL = 3;

// Preset ICP ids from spec §2 #9.
const ICP_PRESETS = [
  'saas_founder_pre_pmf',
  'saas_founder_post_pmf',
  'shopify_merchant',
  'devtools_engineer',
  'fintech_ops_buyer',
] as const;

const IcpPresetSchema = z.object({
  preset_id: z.enum(ICP_PRESETS),
});

const IcpInlineSchema = z.object({
  description: z.string().optional(),
  stage: z.string().optional(),
  team_size: z.string().optional(),
  stack: z.string().optional(),
  pain: z.string().optional(),
  entry_point: z.string().optional(),
  budget_authority: z.string().optional(),
}).passthrough();

const CreateStudyBodySchema = z.object({
  urls: z.array(z.string().url()).min(1).max(2),
  icp: z.union([IcpPresetSchema, IcpInlineSchema]),
  n_visits: z.number().int().min(1).max(100),
});

/**
 * Extract eTLD+1 from a URL string. Returns null if unparseable.
 * Uses tldts.getDomain which returns e.g. 'example.com' for
 * 'https://sub.example.com/path'.
 */
function getEtldPlusOne(urlStr: string): string | null {
  try {
    const domain = tldts.getDomain(urlStr);
    return domain ?? null;
  } catch {
    return null;
  }
}

export async function registerStudiesRoutes(
  app: FastifyInstance,
  pool: Pool,
  env: Env,
): Promise<void> {
  const apiKeyMiddleware = buildApiKeyMiddleware(pool);

  // POST /studies
  app.post(
    '/studies',
    { preHandler: [apiKeyMiddleware] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const account = req.account!;

      // Parse + validate body.
      const bodyResult = CreateStudyBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        const msg = bodyResult.error.issues.map((i) => i.message).join('; ');
        return reply.code(422).send({ error: msg });
      }
      const body = bodyResult.data;

      // §2 #1: Verify each URL's eTLD+1 is in account.verified_domains.
      for (const url of body.urls) {
        const etld = getEtldPlusOne(url);
        if (!etld) {
          return reply.code(422).send({ error: `invalid URL: ${url}` });
        }
        if (!account.verified_domains.includes(etld)) {
          return reply.code(422).send({ error: `unverified domain: ${etld}` });
        }
      }

      const n = body.n_visits;
      // §5.5: total reservation = urls × n_visits × 5¢ + 3¢ (once-per-study cluster_label).
      const estCents = body.urls.length * n * CENTS_PER_VISIT_EST + CENTS_PER_STUDY_CLUSTER_LABEL;
      const today = new Date().toISOString().slice(0, 10);

      // §5.5 / §5.7: Reserve estimated spend.
      // We import postgres (the slonik-like lib) for reserveSpend; but our pool
      // is a pg.Pool. To avoid spinning up a second client, we run the atomic
      // spend SQL directly via pg.Pool inline here. reserveSpend uses the
      // postgres() tagged-template API which is different from pg.Pool.
      //
      // Rather than instantiating a second postgres() connection just for one
      // upsert, we inline the equivalent SQL via pg.Pool. This is a deliberate
      // deviation from calling reserveSpend() directly (which takes a postgres
      // sql tagged-template client). The semantics are identical.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Atomic spend reservation per spec §5.5.
        // estCents = urls × n_visits × 5¢ + 3¢ (cluster_label).
        const spendRows = await client.query<{ cents: number }>(
          `INSERT INTO llm_spend_daily (account_id, date, kind, cents)
             VALUES ($1, $2::date, 'visit', $3)
             ON CONFLICT (account_id, date, kind)
             DO UPDATE SET cents = llm_spend_daily.cents + EXCLUDED.cents
             WHERE llm_spend_daily.cents + EXCLUDED.cents <= $4
             RETURNING cents`,
          [String(account.id), today, estCents, env.DAILY_CAP_CENTS],
        );

        if (spendRows.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.code(402).send({ error: 'daily spend cap exceeded' });
        }

        // Create study row.
        const kind = body.urls.length === 2 ? 'paired' : 'single';
        const studyResult = await client.query<{ id: string }>(
          `INSERT INTO studies (account_id, kind, status)
           VALUES ($1, $2, 'capturing')
           RETURNING id`,
          [String(account.id), kind],
        );
        const studyId = studyResult.rows[0]!.id;

        // Insert N backstory rows with the ICP payload.
        const icpPayload = JSON.stringify(body.icp);
        for (let idx = 0; idx < n; idx++) {
          await client.query(
            `INSERT INTO backstories (study_id, idx, payload)
             VALUES ($1, $2, $3::jsonb)`,
            [studyId, idx, icpPayload],
          );
        }

        // Enqueue visit queue rows — one per (backstory, url variant).
        // Worker polls visits table with status='pending' (issue #8 wired this).
        // variant_idx: 0 = URL[0], 1 = URL[1] for paired studies.
        const backstoryRows = await client.query<{ id: string; idx: number }>(
          `SELECT id, idx FROM backstories WHERE study_id = $1 ORDER BY idx`,
          [studyId],
        );
        for (const bs of backstoryRows.rows) {
          for (let variantIdx = 0; variantIdx < body.urls.length; variantIdx++) {
            await client.query(
              `INSERT INTO visits (study_id, backstory_id, variant_idx, status)
               VALUES ($1, $2, $3, 'started')`,
              [studyId, bs.id, variantIdx],
            );
          }
        }

        await client.query('COMMIT');

        return reply.code(201).send({ study_id: Number(studyId), status: 'capturing' });
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      } finally {
        client.release();
      }
    },
  );

  type GetStudyRequest = FastifyRequest<{ Params: { id: string } }>;
  // GET /studies/:id
  app.get<{ Params: { id: string } }>(
    '/studies/:id',
    { preHandler: [apiKeyMiddleware] },
    async (req: GetStudyRequest, reply: FastifyReply) => {
      const account = req.account!;
      const studyId = req.params.id;

      const studyResult = await pool.query<{
        id: string;
        account_id: string;
        status: string;
        created_at: Date;
        finalized_at: Date | null;
      }>(
        `SELECT id, account_id, status, created_at, finalized_at
           FROM studies WHERE id = $1`,
        [studyId],
      );

      const study = studyResult.rows[0];
      // 404 if not found OR not owned by caller (don't leak existence per spec §2 #1).
      if (!study || study.account_id !== String(account.id)) {
        return reply.code(404).send({ error: 'study not found' });
      }

      // Visit progress.
      const progressResult = await pool.query<{
        status: string;
        cnt: string;
      }>(
        `SELECT status, count(*) AS cnt
           FROM visits WHERE study_id = $1
           GROUP BY status`,
        [studyId],
      );

      let okCount = 0;
      let failedCount = 0;
      let total = 0;
      for (const row of progressResult.rows) {
        const cnt = Number(row.cnt);
        total += cnt;
        if (row.status === 'ok') okCount += cnt;
        else if (row.status === 'failed' || row.status === 'indeterminate') failedCount += cnt;
      }

      return reply.code(200).send({
        id: Number(study.id),
        status: study.status,
        visit_progress: { ok: okCount, failed: failedCount, total },
        started_at: study.created_at.toISOString(),
        finalized_at: study.finalized_at?.toISOString() ?? null,
      });
    },
  );
}
