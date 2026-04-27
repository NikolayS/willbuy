/**
 * routes/studies.ts — POST /studies + GET /studies/:id (issue #30) +
 * GET /api/studies (issue #85, study list page).
 *
 * Spec refs: §5.1 (data flow), §2 #1 (verified-domain authorization),
 * §5.11 (study status transitions), §2 #18 (paired A/B = exactly 2 URLs),
 * §5.18 (report at /dashboard/studies/:id and /r/:slug).
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
 *
 * GET /api/studies (issue #85):
 *   - Behind wb_session middleware (PR #95).
 *   - Query: limit (default 20, max 100), cursor (opaque base64 of "iso|id").
 *   - Returns { studies: [...], next_cursor: string|null }.
 *   - DESC by created_at, id (composite cursor for stable scrolling).
 *   - Filters by req.account.id (§2 #1).
 *   - Each row exposes id, status, created_at, finalized_at, n_visits, urls,
 *     and visit_progress {ok,failed,total} for the table render.
 */

import { createHash } from 'node:crypto';
import tldts from 'tldts';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type postgres from 'postgres';

import { buildApiKeyMiddleware } from '../auth/api-key.js';
import { buildSessionMiddleware } from '../auth/session.js';
import type { Env } from '../env.js';
import type { ResendClient } from '../email/resend.js';
import { maybeWarnCap } from '../billing/cap-warning.js';
import { recordStudyStarted } from '../metrics/registry.js';

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
  sql: ReturnType<typeof postgres>,
  resend: ResendClient,
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
        // urls[]: persisted so capture-worker can read studies.urls[variant_idx]
        // when leasing a visit (issue #84, PR #96 B3 fix). The 1..2 cardinality
        // CHECK constraint mirrors the zod schema above; the column was added
        // in migration 0017_studies_urls.sql.
        const kind = body.urls.length === 2 ? 'paired' : 'single';
        const studyResult = await client.query<{ id: string }>(
          `INSERT INTO studies (account_id, kind, status, urls)
           VALUES ($1, $2, 'capturing', $3::text[])
           RETURNING id`,
          [String(account.id), kind, body.urls],
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

        // Issue #119 / spec §5.14: business-counter increment AFTER commit so
        // we don't inflate the count for rolled-back transactions.
        recordStudyStarted({ kind });

        // §5.6: fire-and-forget cap-warning email. maybeWarnCap is idempotent
        // (ON CONFLICT DO NOTHING) — safe to call without awaiting in the
        // response path. Errors are logged inside maybeWarnCap, not propagated.
        void maybeWarnCap({
          sql,
          account_id: account.id,
          date: today,
          new_cents: spendRows.rows[0]!.cents,
          daily_cap_cents: env.DAILY_CAP_CENTS,
          owner_email: account.owner_email,
          study_id: studyId,
          resend,
        });

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
        report_public: boolean | null;
      }>(
        `SELECT s.id, s.account_id, s.status, s.created_at, s.finalized_at,
                r."public" AS report_public
           FROM studies s
           LEFT JOIN reports r ON r.study_id = s.id
          WHERE s.id = $1`,
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
        ...(study.report_public !== null ? { report_public: study.report_public } : {}),
      });
    },
  );

  // ── POST /studies/:id/publish (issue #204) ────────────────────────────────
  //
  // Owner opt-in to public listing (spec §2 #20). Sets reports.public = true
  // for the report linked to this study. Idempotent — safe to call repeatedly.
  // 404 if study not owned by caller or has no report yet.
  app.post<{ Params: { id: string } }>(
    '/studies/:id/publish',
    { preHandler: [apiKeyMiddleware] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const account = req.account!;
      const studyId = req.params.id;

      // Single atomic UPDATE joining reports → studies enforces ownership in one
      // round-trip (no TOCTOU). Returns 0 rows when: study doesn't exist, account
      // mismatch, or no report exists yet — all map to 404 (no existence leak,
      // spec §2 #20).
      const result = await pool.query<{ study_id: string }>(
        `UPDATE reports r
            SET public = true
           FROM studies s
          WHERE r.study_id = s.id
            AND s.id = $1
            AND s.account_id = $2
          RETURNING r.study_id`,
        [studyId, String(account.id)],
      );

      if (result.rowCount === 0) {
        return reply.code(404).send({ error: 'study not found' });
      }

      return reply.code(200).send({
        study_id: Number(studyId),
        public: true,
      });
    },
  );

  // ── GET /api/studies (issue #85) ───────────────────────────────────────────
  //
  // Session-cookie-authenticated paginated list of the caller's studies.
  // Pagination uses an opaque keyset cursor over (created_at, id) DESC so the
  // ordering is stable when new studies are inserted between page fetches
  // (offset-based pagination would skip/duplicate rows in that case).
  //
  // The cursor is base64url("<created_at_iso>|<id>") of the LAST row on the
  // current page. The next page query is:
  //   WHERE (created_at, id) < (cursor.created_at, cursor.id)
  //
  // Returns 400 on a malformed cursor (per AC6) — never silently degrades.
  // Pass pool so verified_domains is loaded from DB (needed for POST /api/studies).
  const sessionMiddleware = buildSessionMiddleware(env.SESSION_HMAC_KEY, env.NODE_ENV, pool);

  // ── GET /api/studies/:id (issue #209) ─────────────────────────────────────
  //
  // Session-cookie mirror of GET /studies/:id (which uses API-key auth).
  // Used by the dashboard's client component — browsers send session cookies
  // but no API key, so the apiKey-authenticated route always returns 401
  // in production. Same ownership guard and response shape.
  app.get<{ Params: { id: string } }>(
    '/api/studies/:id',
    { preHandler: [sessionMiddleware] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const account = req.account!;
      const studyId = req.params.id;

      const studyResult = await pool.query<{
        id: string;
        account_id: string;
        status: string;
        created_at: Date;
        finalized_at: Date | null;
        slug: string | null;
        report_public: boolean | null;
      }>(
        `SELECT s.id, s.account_id, s.status, s.created_at, s.finalized_at,
                r.study_id::text AS slug, r.public AS report_public
           FROM studies s
           LEFT JOIN reports r ON r.study_id = s.id
          WHERE s.id = $1`,
        [studyId],
      );

      const study = studyResult.rows[0];
      if (!study || study.account_id !== String(account.id)) {
        return reply.code(404).send({ error: 'study not found' });
      }

      const progressResult = await pool.query<{ status: string; cnt: string }>(
        `SELECT status, count(*) AS cnt FROM visits WHERE study_id = $1 GROUP BY status`,
        [studyId],
      );

      let okCount = 0, failedCount = 0, total = 0;
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
        slug: study.slug ?? undefined,
        ...(study.report_public !== null ? { report_public: study.report_public } : {}),
      });
    },
  );

  // ── POST /api/studies (issue #210) ────────────────────────────────────────
  //
  // Session-cookie mirror of POST /studies (API-key auth). Allows dashboard
  // users to create studies from the browser without a programmatic API key.
  // Identical logic to POST /studies; session middleware loads verified_domains
  // from the DB (pool passed above) so domain verification works the same way.
  app.post(
    '/api/studies',
    { preHandler: [sessionMiddleware] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const account = req.account!;

      const bodyResult = CreateStudyBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        const msg = bodyResult.error.issues.map((i) => i.message).join('; ');
        return reply.code(422).send({ error: msg });
      }
      const body = bodyResult.data;

      for (const url of body.urls) {
        const etld = getEtldPlusOne(url);
        if (!etld) return reply.code(422).send({ error: `invalid URL: ${url}` });
        if (!account.verified_domains.includes(etld)) {
          return reply.code(422).send({ error: `unverified domain: ${etld}` });
        }
      }

      const n = body.n_visits;
      const estCents = body.urls.length * n * CENTS_PER_VISIT_EST + CENTS_PER_STUDY_CLUSTER_LABEL;
      const today = new Date().toISOString().slice(0, 10);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

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

        const kind = body.urls.length === 2 ? 'paired' : 'single';
        const studyResult = await client.query<{ id: string }>(
          `INSERT INTO studies (account_id, kind, status, urls)
           VALUES ($1, $2, 'capturing', $3::text[])
           RETURNING id`,
          [String(account.id), kind, body.urls],
        );
        const studyId = studyResult.rows[0]!.id;

        const icpPayload = JSON.stringify(body.icp);
        for (let idx = 0; idx < n; idx++) {
          await client.query(
            `INSERT INTO backstories (study_id, idx, payload) VALUES ($1, $2, $3::jsonb)`,
            [studyId, idx, icpPayload],
          );
        }

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

        recordStudyStarted({ kind });
        void maybeWarnCap({
          sql,
          account_id: account.id,
          date: today,
          new_cents: spendRows.rows[0]!.cents,
          daily_cap_cents: env.DAILY_CAP_CENTS,
          owner_email: account.owner_email,
          study_id: studyId,
          resend,
        });

        return reply.code(201).send({ study_id: Number(studyId), status: 'capturing' });
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // ── POST /api/studies/:id/publish (session-cookie auth) ───────────────────
  //
  // Session-cookie mirror of POST /studies/:id/publish (API-key auth).
  // Allows dashboard users to make a report public without a programmatic key.
  app.post<{ Params: { id: string } }>(
    '/api/studies/:id/publish',
    { preHandler: [sessionMiddleware] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const account = req.account!;
      const studyId = req.params.id;

      const result = await pool.query<{ study_id: string }>(
        `UPDATE reports r
            SET public = true
           FROM studies s
          WHERE r.study_id = s.id
            AND s.id = $1
            AND s.account_id = $2
          RETURNING r.study_id`,
        [studyId, String(account.id)],
      );

      if (result.rowCount === 0) {
        return reply.code(404).send({ error: 'study not found' });
      }

      return reply.code(200).send({ study_id: Number(studyId), public: true });
    },
  );

  const ListQuerySchema = z.object({
    limit: z.coerce.number().int().positive().optional(),
    cursor: z.string().optional(),
  });

  type ListQuery = z.infer<typeof ListQuerySchema>;

  interface ListStudyRow {
    id: string;
    status: string;
    created_at: Date;
    finalized_at: Date | null;
    urls: string[] | null;
    n_visits: string;
    ok: string;
    failed: string;
    total: string;
  }

  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/studies',
    { preHandler: [sessionMiddleware] },
    async (
      req: FastifyRequest<{ Querystring: Record<string, string | undefined> }>,
      reply: FastifyReply,
    ) => {
      const account = req.account!;

      // Parse + clamp the query.
      const parsed = ListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid query' });
      }
      const q: ListQuery = parsed.data;
      const requested = q.limit ?? 20;
      // Clamp to [1, 100] — silently per AC3.
      const limit = Math.min(100, Math.max(1, requested));

      // Decode cursor if present.
      // Format: base64url("<created_at_iso>|<id>"). We accept either base64url
      // or standard base64 (browsers / curl users may pass either) — Buffer's
      // base64 decoder is lenient.
      let cursorCreatedAt: string | null = null;
      let cursorId: string | null = null;
      if (q.cursor) {
        let decoded: string;
        try {
          decoded = Buffer.from(q.cursor, 'base64url').toString('utf8');
        } catch {
          return reply.code(400).send({ error: 'invalid cursor' });
        }
        const sep = decoded.indexOf('|');
        if (sep === -1) {
          return reply.code(400).send({ error: 'invalid cursor' });
        }
        const isoPart = decoded.slice(0, sep);
        const idPart = decoded.slice(sep + 1);
        // Reject obviously malformed payloads.
        if (!isoPart || !idPart) {
          return reply.code(400).send({ error: 'invalid cursor' });
        }
        // Parse the ISO timestamp — reject NaN.
        const t = Date.parse(isoPart);
        if (Number.isNaN(t)) {
          return reply.code(400).send({ error: 'invalid cursor' });
        }
        // id must be a positive integer string.
        if (!/^\d+$/.test(idPart)) {
          return reply.code(400).send({ error: 'invalid cursor' });
        }
        cursorCreatedAt = isoPart;
        cursorId = idPart;
      }

      // Fetch limit+1 rows so we can determine if a next page exists without
      // an extra COUNT(*) round-trip. The +1th row, if present, is dropped
      // from the response and used to mint next_cursor.
      const fetchLimit = limit + 1;

      const params: Array<string | number> = [String(account.id)];
      let where = `s.account_id = $1`;
      if (cursorCreatedAt && cursorId) {
        // Composite keyset comparison: (created_at, id) < (cursor.created_at, cursor.id).
        params.push(cursorCreatedAt, cursorId);
        where += ` AND (s.created_at, s.id) < ($2::timestamptz, $3::bigint)`;
      }
      params.push(fetchLimit);
      const limitParamIdx = params.length;

      // LEFT JOIN backstories for n_visits (count of backstory rows).
      // LEFT JOIN visits for visit_progress aggregates.
      // We aggregate per study via subqueries — clearer SQL than two LEFT JOINs
      // with a GROUP BY (which would multiply rows × visit_count × backstory_count).
      const sql = `
        SELECT s.id,
               s.status,
               s.created_at,
               s.finalized_at,
               s.urls,
               COALESCE(bs.n_visits, 0)::text AS n_visits,
               COALESCE(v.ok, 0)::text AS ok,
               COALESCE(v.failed, 0)::text AS failed,
               COALESCE(v.total, 0)::text AS total
          FROM studies s
          LEFT JOIN (
            SELECT study_id, COUNT(*) AS n_visits
              FROM backstories GROUP BY study_id
          ) bs ON bs.study_id = s.id
          LEFT JOIN (
            SELECT study_id,
                   COUNT(*) FILTER (WHERE status = 'ok')                              AS ok,
                   COUNT(*) FILTER (WHERE status IN ('failed', 'indeterminate'))      AS failed,
                   COUNT(*)                                                           AS total
              FROM visits GROUP BY study_id
          ) v ON v.study_id = s.id
         WHERE ${where}
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT $${limitParamIdx}
      `;

      const result = await pool.query<ListStudyRow>(sql, params);
      const rows = result.rows;

      const hasNext = rows.length > limit;
      const pageRows = hasNext ? rows.slice(0, limit) : rows;

      const studies = pageRows.map((r) => ({
        id: Number(r.id),
        status: r.status,
        created_at: r.created_at.toISOString(),
        finalized_at: r.finalized_at?.toISOString() ?? null,
        n_visits: Number(r.n_visits),
        urls: r.urls ?? [],
        visit_progress: {
          ok: Number(r.ok),
          failed: Number(r.failed),
          total: Number(r.total),
        },
      }));

      let next_cursor: string | null = null;
      if (hasNext) {
        const last = pageRows[pageRows.length - 1]!;
        const raw = `${last.created_at.toISOString()}|${last.id}`;
        next_cursor = Buffer.from(raw, 'utf8').toString('base64url');
      }

      return reply.code(200).send({ studies, next_cursor });
    },
  );

  // ── POST /api/studies/:id/share-token (issue #487) ────────────────────────
  //
  // Mints a private revocable share link for the study's report.
  // Spec refs: §2 #20 (share-token minting), user story 3 (CRO consultant
  // mints a private share link for a client).
  //
  // - Owner POSTs to mint a 22-char nanoid token for their study's report.
  // - Server stores SHA-256 hash of the token (never the raw token).
  // - Default expiry: 90 days from now.
  // - Returns the raw token ONCE — caller must save the link.
  // - Link form: /r/<slug>?t=<token> where slug = study_id::text (amendment A12).
  //
  // Errors:
  //   401 — no/invalid session (enforced by sessionMiddleware preHandler).
  //   404 — study not owned by caller, or study has no report row yet.
  //   409 — a non-revoked, non-expired share token already exists for this
  //          report_slug; caller should revoke first (revocation deferred).
  app.post<{ Params: { id: string } }>(
    '/api/studies/:id/share-token',
    { preHandler: [sessionMiddleware] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const account = req.account!;
      const studyId = req.params.id;

      // Verify caller owns this study AND it already has a report row.
      // A single JOIN enforces both constraints in one round-trip (no TOCTOU).
      const reportResult = await pool.query<{ study_id: string }>(
        `SELECT r.study_id::text AS study_id
           FROM reports r
           JOIN studies s ON s.id = r.study_id
          WHERE s.id = $1
            AND s.account_id = $2`,
        [studyId, String(account.id)],
      );

      if (reportResult.rowCount === 0) {
        return reply.code(404).send({ error: 'study not found' });
      }

      // §2 #20: report slug = study_id::text (amendment A12).
      const reportSlug = studyId;

      // 409 if an active (non-revoked, non-expired) token already exists.
      const existingResult = await pool.query<{ id: string }>(
        `SELECT id FROM share_tokens
          WHERE report_slug = $1
            AND revoked_at IS NULL
            AND expires_at > now()`,
        [reportSlug],
      );

      if ((existingResult.rowCount ?? 0) > 0) {
        return reply.code(409).send({
          error: 'a share token already exists for this report; revoke it first',
        });
      }

      // Mint a 22-char nanoid token and store only its SHA-256 hash.
      const rawToken = nanoid(22);
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      // Default expiry: 90 days from now (spec §2 #20).
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO share_tokens (report_slug, token_hash, expires_at, account_id)
         VALUES ($1, $2, $3, $4)`,
        [reportSlug, tokenHash, expiresAt.toISOString(), String(account.id)],
      );

      const shareUrl = `https://willbuy.dev/r/${reportSlug}?t=${rawToken}`;

      return reply.code(201).send({
        token: rawToken,
        url: shareUrl,
        expires_at: expiresAt.toISOString(),
      });
    },
  );
}
