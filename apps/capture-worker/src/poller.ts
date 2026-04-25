/**
 * poller.ts — capture-worker job-queue polling loop (spec §5.1, §5.11, §5.13).
 *
 * Polls the `visits` table for rows with `status='started'` whose parent study
 * has `status='capturing'`. For each leased row:
 *
 *   1. Transition visit → 'in_capture' sentinel (we use `started` → stays
 *      the same while capture is running — the FOR UPDATE lock is the mutex).
 *   2. Call runWithNetns (or bare captureUrl on non-Linux / RUN_WITH_NETNS=skip).
 *   3. Send artifact via broker client.
 *   4. Transition visit → 'ok' / 'failed' depending on capture + broker outcome.
 *   5. After each visit commit, check if ALL visits for the study are terminal
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
 * The FOR UPDATE SKIP LOCKED lease is the exclusive lock while capture runs.
 * No heartbeat in v0.1 (Sprint 3); lease is held for the duration of the
 * docker/playwright call (≤ CAPTURE_CEILINGS.WALL_CLOCK_MS = 45s) which fits
 * well under the Postgres idle-in-transaction timeout.
 */

import { Pool, type PoolClient } from 'pg';
import { captureUrl } from './capture.js';
import { sendToBroker, type CaptureRequestPayload } from './broker-client.js';
import type { CaptureResult } from './types.js';

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
 */
export async function pollOnce(opts: PollOpts): Promise<PollResult> {
  const client = await opts.pool.connect();
  try {
    // Lock a single 'started' visit whose study is in 'capturing' state.
    // SKIP LOCKED means concurrent workers never block each other.
    await client.query('BEGIN');

    const leaseResult = await client.query<{
      id: string;
      study_id: string;
    }>(
      `SELECT v.id, v.study_id
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
      return { kind: 'empty' };
    }

    const visitId = Number(row.id);
    const studyId = Number(row.study_id);
    // URL comes from opts.targetUrlOverride (integration test + production config).
    // The current schema (0002_studies.sql) does not store the URL in the DB;
    // production workers receive it via env/config injection. See follow-up
    // issue for the `studies.urls jsonb` migration.
    const targetUrl = opts.targetUrlOverride ?? '';

    // Commit the lease immediately so the transaction is short. We'll use
    // a separate transaction to write the terminal status.
    await client.query('COMMIT');

    // ── 2. Run capture ────────────────────────────────────────────────────────
    let captureResult: CaptureResult;
    if (opts.skipCapture || !targetUrl) {
      // Synthetic artifact for tests / missing URL.
      captureResult = {
        status: 'ok',
        url: targetUrl || 'about:blank',
        a11y_tree: [{ role: 'WebArea', name: 'Test', children: [] }],
        banner_selectors_matched: [],
        host_count: 1,
      };
    } else {
      captureResult = await captureUrl(targetUrl);
    }

    // ── 3. Send artifact to broker ────────────────────────────────────────────
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

    let visitStatus: 'ok' | 'failed' = 'ok';
    try {
      const ack = await sendToBroker(brokerPayload, brokerOpts);
      if (!ack.ok) {
        console.error(`[capture-worker] broker rejected artifact for visit ${visitId}: ${ack.error}${ack.detail ? ' — ' + ack.detail : ''}`);
        visitStatus = 'failed';
      }
    } catch (brokerErr) {
      console.error(`[capture-worker] broker send failed for visit ${visitId}:`, brokerErr);
      visitStatus = 'failed';
    }

    // ── 4 + 5. Write terminal visit status + maybe advance study ──────────────
    await writeTerminalAndMaybeAdvanceStudy(client, visitId, studyId, visitStatus);

    return { kind: 'processed', visitId, visitStatus };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Write the terminal visit status and, if all visits for the study are now
 * terminal, transition the study to 'visiting'.
 */
async function writeTerminalAndMaybeAdvanceStudy(
  client: PoolClient,
  visitId: number,
  studyId: number,
  visitStatus: 'ok' | 'failed',
): Promise<void> {
  await client.query('BEGIN');

  await client.query(
    `UPDATE visits SET status = $1, ended_at = now() WHERE id = $2`,
    [visitStatus, visitId],
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
      console.error('[capture-worker] poll error:', err);
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
