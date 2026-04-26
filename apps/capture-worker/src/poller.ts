/**
 * poller.ts — capture-worker job-queue polling loop (spec §5.1, §5.11, §5.13).
 *
 * Polls the `visits` table for rows with `status='started'` whose parent study
 * has `status='capturing'`. For each leased row:
 *
 *   1. SELECT … FOR UPDATE SKIP LOCKED takes a row lock that blocks any
 *      concurrent worker from re-leasing this visit. The transaction stays
 *      OPEN for the duration of the capture so the row lock is held throughout.
 *   2. Call runWithNetns (or bare captureUrl on non-Linux / RUN_WITH_NETNS=skip).
 *   3. Send artifact via broker client.
 *   4. Transition visit → 'ok' / 'failed' depending on capture + broker outcome,
 *      then COMMIT — releasing the row lock.
 *   5. In a fresh transaction, check if ALL visits for the study are terminal
 *      (ok | failed | indeterminate). If yes → transition study → 'visiting'.
 *
 * The actual visit status values are constrained by 0005_visits.sql:
 *   check (status in ('started', 'ok', 'failed', 'indeterminate'))
 *
 * So this worker uses 'started' as the "ready to be captured" state.
 * The spec's logical `pending → capturing → visiting` maps to the DB as:
 *   visit.status='started' → capture runs → visit.status='ok'/'failed'
 *   study.status='capturing' (already set by POST /studies) → 'visiting'
 *
 * Why the long-running transaction is safe (PR #96 Finding B2):
 *   The FOR UPDATE SKIP LOCKED row lock is the lease. If the lock is released
 *   before the capture completes (i.e. by an early COMMIT) a concurrent worker
 *   will re-lease the same row and produce duplicate broker artifacts. We
 *   therefore keep the txn OPEN across capture+broker write. The transaction
 *   sets `statement_timeout=0` and `idle_in_transaction_session_timeout` to
 *   2× the wall-clock capture ceiling (45 s × 2 = 90 s) so a wedged capture
 *   eventually releases the lock for sweeper recovery.
 *
 * No heartbeat in v0.1 (Sprint 3); lease is held for the duration of the
 * docker/playwright call (≤ CAPTURE_CEILINGS.WALL_CLOCK_MS = 45s).
 */

import { Pool, type PoolClient } from 'pg';
import { captureUrl } from './capture.js';
import { sendToBroker, type CaptureRequestPayload } from './broker-client.js';
import { buildCaptureWorkerLogger } from './logger.js';
import type { CaptureResult } from './types.js';

const log = buildCaptureWorkerLogger();

export type PollOpts = {
  pool: Pool;
  /** Broker Unix socket path (default: /run/willbuy/broker.sock). */
  brokerSocketPath?: string;
  /**
   * When true, skip capture entirely and write a minimal synthetic artifact.
   * Useful for unit tests that don't want Playwright / Docker.
   */
  skipCapture?: boolean;
  /**
   * Override the target URL for every visit (ignores the stored URL).
   * Used by integration tests to point at the local fixture server.
   */
  targetUrlOverride?: string;
  /**
   * Broker client timeout in ms (default: 30_000).
   */
  brokerTimeoutMs?: number;
  /**
   * Signal to stop polling after the current iteration.
   * Callers can set this to stop the loop from outside.
   */
  signal?: AbortSignal;
};

export type PollResult =
  | { kind: 'processed'; visitId: number; visitStatus: 'ok' | 'failed' }
  | { kind: 'empty' };

/**
 * Poll once for a pending visit, run capture, update DB.
 * Returns the outcome of this single poll tick.
 *
 * Lease durability (PR #96 B2 fix): the `SELECT … FOR UPDATE SKIP LOCKED`
 * row lock is the lease, and the lock is held by a single transaction that
 * stays open across the capture+broker write. We set
 * `idle_in_transaction_session_timeout` to bound a wedged worker. The
 * capture's own wall-clock ceiling is CAPTURE_CEILINGS.WALL_CLOCK_MS = 45 s.
 *
 * URL source (PR #96 B3 fix): we read `studies.urls[variant_idx]` from the
 * row joined onto the visit. If `opts.targetUrlOverride` is set (integration
 * tests, manual debugging) it wins over the DB value. If neither is present
 * AND `opts.skipCapture` is false the visit is failed with `terminal_reason
 * = 'no_url'` rather than silently producing an `about:blank` artifact.
 */
export async function pollOnce(opts: PollOpts): Promise<PollResult> {
  const client = await opts.pool.connect();
  let leaseHeld = false;
  let visitId = 0;
  let studyId = 0;
  let visitStatus: 'ok' | 'failed' = 'ok';
  try {
    // Lock a single 'started' visit whose study is in 'capturing' state.
    // SKIP LOCKED means concurrent workers never block each other.
    await client.query('BEGIN');
    leaseHeld = true;
    // Bound a wedged transaction at 2× the wall-clock ceiling so an
    // orphaned lease eventually releases the row lock for sweeper recovery.
    // CAPTURE_CEILINGS.WALL_CLOCK_MS = 45 000 → 90 000 ms here.
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '90s'`);

    const leaseResult = await client.query<{
      id: string;
      study_id: string;
      variant_idx: number;
      study_url: string | null;
    }>(
      `SELECT v.id,
              v.study_id,
              v.variant_idx,
              -- variant_idx is 0-based externally; PostgreSQL arrays are 1-based.
              s.urls[v.variant_idx + 1] AS study_url
         FROM visits v
         JOIN studies s ON s.id = v.study_id
        WHERE v.status = 'started'
          AND s.status = 'capturing'
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

    // URL precedence (B3 fix): explicit override (tests) → studies.urls[variant_idx]
    // → empty (only valid when skipCapture=true).
    const targetUrl = opts.targetUrlOverride ?? row.study_url ?? '';

    // ── 2. Run capture (lock still held; lease is durable) ────────────────────
    let captureResult: CaptureResult | null = null;
    let noUrlFailure = false;
    if (opts.skipCapture) {
      // Test-only synthetic artifact (e.g. macOS dev with no Playwright/netns).
      captureResult = {
        status: 'ok',
        url: targetUrl || 'about:blank',
        a11y_tree: [{ role: 'WebArea', name: 'Test', children: [] }],
        banner_selectors_matched: [],
        host_count: 1,
      };
    } else if (!targetUrl) {
      // Production safety (B3 fix): refuse to silently capture about:blank.
      // Fail-fast: write 'failed' status, skip the broker write entirely.
      log.error(
        { event: 'capture.no_url', visit_id: String(visitId), study_id: String(studyId) },
        'visit has no URL configured; studies.urls[variant_idx] is null AND no targetUrlOverride — marking visit failed',
      );
      noUrlFailure = true;
    } else {
      captureResult = await captureUrl(targetUrl);
    }

    // ── 3. Send artifact to broker (skipped on no-URL fail-fast) ──────────────
    if (noUrlFailure) {
      visitStatus = 'failed';
    } else if (captureResult) {
      const brokerPayload: CaptureRequestPayload = {
        status: captureResult.status,
        a11y_tree_b64: Buffer.from(JSON.stringify(captureResult.a11y_tree), 'utf8').toString('base64'),
        banner_selectors_matched: captureResult.banner_selectors_matched,
        overlays_unknown_present: false,
        host_count: captureResult.host_count,
        ...(captureResult.blocked_reason !== undefined && { blocked_reason: captureResult.blocked_reason }),
        ...(captureResult.breach_reason !== undefined && { breach_reason: captureResult.breach_reason }),
      };

      const brokerOpts = {
        ...(opts.brokerSocketPath !== undefined && { socketPath: opts.brokerSocketPath }),
        ...(opts.brokerTimeoutMs !== undefined && { timeoutMs: opts.brokerTimeoutMs }),
      };

      visitStatus = captureResult.status === 'ok' ? 'ok' : 'failed';
      try {
        const ack = await sendToBroker(brokerPayload, brokerOpts);
        if (!ack.ok) {
          log.error(
            { event: 'broker.rejected', visit_id: String(visitId), error_class: ack.error, detail: ack.detail },
            'broker rejected artifact',
          );
          visitStatus = 'failed';
        }
      } catch (brokerErr) {
        log.error(
          { event: 'broker.send_failed', visit_id: String(visitId), error_class: brokerErr instanceof Error ? brokerErr.name : 'UnknownError' },
          'broker send failed',
        );
        visitStatus = 'failed';
      }
    }

    // ── 4. Write terminal visit status WITHIN the lease transaction ───────────
    // Updating the row we hold FOR UPDATE is safe; commit releases the lock.
    await client.query(
      `UPDATE visits SET status = $1, ended_at = now() WHERE id = $2`,
      [visitStatus, visitId],
    );
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

  // ── 5. Maybe advance study → 'visiting' (separate txn; lock already released) ─
  // Run only when we successfully processed a visit (visitId !== 0).
  if (visitId !== 0) {
    const advClient = await opts.pool.connect();
    try {
      await maybeAdvanceStudy(advClient, studyId);
    } finally {
      advClient.release();
    }
  }

  return { kind: 'processed', visitId, visitStatus };
}

/**
 * If all visits for the study are now terminal (ok | failed | indeterminate),
 * transition the study from 'capturing' → 'visiting'. Idempotent.
 *
 * Runs in its own transaction AFTER the visit-lease transaction commits
 * (PR #96 B2 fix) so we never hold the visit row lock while taking the
 * study row lock — and concurrent workers see the freshly-committed visit
 * status.
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

    // Check if ALL visits for this study are now terminal.
    // Terminal visit statuses: ok | failed | indeterminate.
    const pendingResult = await client.query<{ pending_count: string }>(
      `SELECT count(*) AS pending_count
         FROM visits
        WHERE study_id = $1
          AND status NOT IN ('ok', 'failed', 'indeterminate')`,
      [studyId],
    );

    const pendingCount = Number(pendingResult.rows[0]?.pending_count ?? 1);

    if (pendingCount === 0) {
      // All visits terminal → advance study to 'visiting' (kicks visitor-worker).
      await client.query(
        `UPDATE studies SET status = 'visiting' WHERE id = $1 AND status = 'capturing'`,
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
 * Run the polling loop until the signal is aborted.
 *
 * Backs off 5 s on empty polls. Errors from individual capture runs are
 * logged but do not crash the loop.
 */
export async function runPollingLoop(opts: PollOpts): Promise<void> {
  const signal = opts.signal;

  while (!signal?.aborted) {
    try {
      const result = await pollOnce(opts);
      if (result.kind === 'empty') {
        // Back off 5 s before next empty poll.
        await sleepUnlessAborted(5_000, signal);
      }
    } catch (err) {
      log.error(
        { event: 'poll.error', error_class: err instanceof Error ? err.name : 'UnknownError' },
        'poll error',
      );
      // Brief pause so a persistent DB error doesn't spin at full speed.
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
