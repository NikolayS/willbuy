/**
 * poller.ts — visitor-worker job-queue polling loop (spec §5.1, §5.11).
 *
 * Polls the `visits` table for rows with `parsed IS NULL` whose parent study
 * has `status='visiting'`. For each leased row:
 *
 *   1. SELECT … FOR UPDATE OF v SKIP LOCKED takes a row lock that blocks any
 *      concurrent worker from re-leasing this visit. The transaction stays
 *      OPEN for the duration of the LLM call so the row lock is held throughout.
 *   2. Read the a11y snapshot from object storage via the injected ObjectStorage.
 *      If a11y_object_key is null (capture not yet linked), fail the visit with
 *      terminal_reason='no_snapshot'.
 *   3. Call runVisit() with the backstory + page snapshot.
 *   4. Write back parsed, score, provider, model, cost_cents, latency_ms,
 *      ended_at. On failure, write terminal_reason='<reason>'.
 *   5. COMMIT — releasing the row lock.
 *   6. In a fresh transaction, check if ALL visits for the study have
 *      parsed IS NOT NULL. If yes → transition study 'visiting' → 'aggregating'.
 *
 * The idle_in_transaction_session_timeout is set to '120s' (visitor lease
 * timeout per spec) so a wedged LLM call eventually releases the row lock
 * for sweeper recovery.
 */

import { Pool, type PoolClient } from 'pg';
import { Backstory } from '@willbuy/shared';
import type { LLMProvider } from '@willbuy/llm-adapter';
import { runVisit } from './visitor.js';
import { buildVisitorWorkerLogger } from './logger.js';

const log = buildVisitorWorkerLogger();

// Re-declare the ObjectStorage interface inline to avoid a cross-package
// dependency on apps/capture-broker. The shape must stay in sync with
// apps/capture-broker/src/storage.ts.
export type ObjectStorage = {
  /** Read bytes by object key; throws if missing. */
  get(key: string): Promise<Buffer>;
  /** Upload bytes; returns void on success. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Cheap existence check. */
  has(key: string): Promise<boolean>;
};

export type PollVisitorOpts = {
  pool: Pool;
  storage: ObjectStorage;
  provider: LLMProvider;
  signal?: AbortSignal;
};

export type PollVisitorResult =
  | { kind: 'processed'; visitId: number; visitOk: boolean }
  | { kind: 'empty' };

/**
 * Poll once for a pending visit (study.status='visiting', visits.parsed IS NULL),
 * run the LLM visitor, and write results back to the DB.
 *
 * Lease durability: the FOR UPDATE SKIP LOCKED row lock is held for the
 * duration of the LLM call inside a single open transaction.
 * idle_in_transaction_session_timeout = '120s' bounds a wedged worker.
 */
export async function pollVisitorOnce(opts: PollVisitorOpts): Promise<PollVisitorResult> {
  const client = await opts.pool.connect();
  let leaseHeld = false;
  let visitId = 0;
  let studyId = 0;
  let visitOk = false;

  try {
    await client.query('BEGIN');
    leaseHeld = true;
    // 120s visitor lease timeout per spec — bounds a wedged LLM call.
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '120s'`);

    const leaseResult = await client.query<{
      id: string;
      study_id: string;
      backstory_payload: string;
      a11y_object_key: string | null;
    }>(
      `SELECT v.id,
              v.study_id,
              b.payload    AS backstory_payload,
              pc.a11y_storage_key AS a11y_object_key
         FROM visits v
         JOIN studies s    ON s.id = v.study_id
         JOIN backstories b ON b.id = v.backstory_id
         LEFT JOIN page_captures pc ON pc.id = v.capture_id
        WHERE s.status = 'visiting'
          AND v.parsed IS NULL
        ORDER BY v.id
        LIMIT 1
        FOR UPDATE OF v SKIP LOCKED`,
    );

    const row = leaseResult.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      leaseHeld = false;
      return { kind: 'empty' };
    }

    visitId = Number(row.id);
    studyId = Number(row.study_id);

    // ── 2. Guard: no snapshot available yet ──────────────────────────────────
    if (row.a11y_object_key === null) {
      log.warn(
        { event: 'visit.no_snapshot', visit_id: String(visitId), study_id: String(studyId) },
        'visit has no a11y snapshot key (capture_id not linked); marking terminal_reason=no_snapshot',
      );
      await client.query(
        `UPDATE visits SET terminal_reason = 'no_snapshot', ended_at = now() WHERE id = $1`,
        [visitId],
      );
      await client.query('COMMIT');
      leaseHeld = false;
      visitOk = false;
      // After commit, attempt study advance in case this was the last visit.
      const advClient = await opts.pool.connect();
      try {
        await maybeAdvanceStudy(advClient, studyId);
      } finally {
        advClient.release();
      }
      return { kind: 'processed', visitId, visitOk };
    }

    // ── 3. Read a11y snapshot from object storage ─────────────────────────────
    let pageSnapshot: string;
    try {
      const buf = await opts.storage.get(row.a11y_object_key);
      pageSnapshot = buf.toString('utf8');
    } catch (storageErr) {
      log.error(
        {
          event: 'visit.storage_read_failed',
          visit_id: String(visitId),
          key: row.a11y_object_key,
          error_class: storageErr instanceof Error ? storageErr.name : 'UnknownError',
        },
        'failed to read a11y snapshot from storage',
      );
      await client.query(
        `UPDATE visits SET terminal_reason = 'no_snapshot', ended_at = now() WHERE id = $1`,
        [visitId],
      );
      await client.query('COMMIT');
      leaseHeld = false;
      visitOk = false;
      const advClient = await opts.pool.connect();
      try {
        await maybeAdvanceStudy(advClient, studyId);
      } finally {
        advClient.release();
      }
      return { kind: 'processed', visitId, visitOk };
    }

    // ── 4. Parse and validate backstory ──────────────────────────────────────
    let backstoryRaw: unknown;
    try {
      backstoryRaw = JSON.parse(row.backstory_payload);
    } catch (parseErr) {
      log.error(
        { event: 'visit.backstory_parse_failed', visit_id: String(visitId) },
        'backstory_payload is not valid JSON',
      );
      await client.query(
        `UPDATE visits SET terminal_reason = 'backstory_invalid', ended_at = now() WHERE id = $1`,
        [visitId],
      );
      await client.query('COMMIT');
      leaseHeld = false;
      visitOk = false;
      const advClient = await opts.pool.connect();
      try {
        await maybeAdvanceStudy(advClient, studyId);
      } finally {
        advClient.release();
      }
      return { kind: 'processed', visitId, visitOk };
    }

    const backstoryResult = Backstory.safeParse(backstoryRaw);
    if (!backstoryResult.success) {
      log.error(
        {
          event: 'visit.backstory_invalid',
          visit_id: String(visitId),
          zod_errors: backstoryResult.error.message,
        },
        'backstory_payload failed zod validation',
      );
      await client.query(
        `UPDATE visits SET terminal_reason = 'backstory_invalid', ended_at = now() WHERE id = $1`,
        [visitId],
      );
      await client.query('COMMIT');
      leaseHeld = false;
      visitOk = false;
      const advClient = await opts.pool.connect();
      try {
        await maybeAdvanceStudy(advClient, studyId);
      } finally {
        advClient.release();
      }
      return { kind: 'processed', visitId, visitOk };
    }

    const backstory = backstoryResult.data;

    // ── 5. Run the LLM visitor (lock still held; lease is durable) ───────────
    const t0 = Date.now();
    const result = await runVisit({
      provider: opts.provider,
      backstory,
      pageSnapshot,
      visitId: String(visitId),
    });
    const latencyMs = Date.now() - t0;

    // ── 6. Write results back within the lease transaction ───────────────────
    if (result.status === 'ok' && result.parsed !== undefined) {
      await client.query(
        `UPDATE visits
            SET parsed      = $1::jsonb,
                score       = $2,
                provider    = $3,
                model       = $4,
                cost_cents  = $5,
                latency_ms  = $6,
                ended_at    = now()
          WHERE id = $7`,
        [
          JSON.stringify(result.parsed),
          // score is not computed here (that is the aggregation phase's job);
          // will_to_buy is stored as the raw score for now.
          result.parsed.will_to_buy ?? null,
          opts.provider.name(),
          opts.provider.model(),
          null, // cost_cents: not available from MockProvider / LocalCliProvider in v0.1
          latencyMs,
          visitId,
        ],
      );
      visitOk = true;
    } else {
      const reason = result.failure_reason ?? 'unknown';
      await client.query(
        `UPDATE visits
            SET terminal_reason = $1,
                provider        = $2,
                model           = $3,
                latency_ms      = $4,
                ended_at        = now()
          WHERE id = $5`,
        [
          reason,
          opts.provider.name(),
          opts.provider.model(),
          latencyMs,
          visitId,
        ],
      );
      visitOk = false;
    }

    await client.query('COMMIT');
    leaseHeld = false;
  } catch (err) {
    if (leaseHeld) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      leaseHeld = false;
    }
    throw err;
  } finally {
    client.release();
  }

  // ── 7. Maybe advance study → 'aggregating' (separate txn after commit) ─────
  if (visitId !== 0) {
    const advClient = await opts.pool.connect();
    try {
      await maybeAdvanceStudy(advClient, studyId);
    } finally {
      advClient.release();
    }
  }

  return { kind: 'processed', visitId, visitOk };
}

/**
 * If all visits for the study have `parsed IS NOT NULL` (or have a
 * terminal_reason set, meaning they failed irrecoverably), transition the
 * study from 'visiting' → 'aggregating'. Idempotent.
 *
 * "Null parsed with a terminal_reason" means the visit failed without a
 * parsed result — we count those as done for the purpose of advancing.
 * Concretely: a visit is still pending iff parsed IS NULL AND terminal_reason
 * IS NULL. When either is non-null the visit is done for this phase.
 *
 * Runs in its own transaction AFTER the visit-lease transaction commits
 * so concurrent workers see freshly-committed results.
 */
async function maybeAdvanceStudy(
  client: PoolClient,
  studyId: number,
): Promise<void> {
  await client.query('BEGIN');
  try {
    // Lock the study row to serialize concurrent advance attempts.
    await client.query(
      `SELECT 1 FROM studies WHERE id = $1 FOR UPDATE`,
      [studyId],
    );

    // A visit is still pending iff both parsed and terminal_reason are null
    // (meaning the visitor phase hasn't processed it yet).
    const pendingResult = await client.query<{ pending_count: string }>(
      `SELECT count(*) AS pending_count
         FROM visits
        WHERE study_id = $1
          AND parsed IS NULL
          AND terminal_reason IS NULL`,
      [studyId],
    );

    const pendingCount = Number(pendingResult.rows[0]?.pending_count ?? 1);

    if (pendingCount === 0) {
      // All visits processed → advance study to 'aggregating'.
      await client.query(
        `UPDATE studies SET status = 'aggregating' WHERE id = $1 AND status = 'visiting'`,
        [studyId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Run the visitor polling loop until the signal is aborted.
 *
 * Backs off 5 s on empty polls. Errors from individual visits are logged but
 * do not crash the loop (1 s backoff on error to avoid spinning on a
 * persistent DB or storage failure).
 */
export async function runVisitorPollingLoop(opts: PollVisitorOpts): Promise<void> {
  const signal = opts.signal;

  while (!signal?.aborted) {
    try {
      const result = await pollVisitorOnce(opts);
      if (result.kind === 'empty') {
        await sleepUnlessAborted(5_000, signal);
      }
    } catch (err) {
      log.error(
        { event: 'visitor_poll.error', error_class: err instanceof Error ? err.name : 'UnknownError' },
        'visitor poll error',
      );
      await sleepUnlessAborted(1_000, signal);
    }
  }
}

function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
