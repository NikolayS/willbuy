// apps/api/src/finalize/aggregator-lock.ts — single-writer aggregator lock (spec §5.11).
//
// SKIP LOCKED choice: recorded in spec §5.11 (v0.5 amendment, 2026-04-24).
// Rationale: SKIP LOCKED returns zero rows immediately if the row is locked
// by another aggregator, freeing the connection-pool slot without waiting for
// the aggregation duration (up to 3 min).  NOWAIT was considered and rejected
// for noisier log semantics (raises lock_not_available exception rather than
// returning zero rows).  Correctness of "exactly one report" is guaranteed by
// UNIQUE(reports.study_id), NOT by this lock.  The lock exists solely to
// avoid duplicate LLM cluster-label spend and wasted compute.
//
// Schema contract (infra/migrations):
//   studies(id, status CHECK('pending'|'capturing'|'visiting'|'aggregating'|'ready'|'failed'))
//   reports(id, study_id UNIQUE FK→studies, ...)
//   late_arrivals(id, study_id FK→studies, visit_id FK→visits, arrived_at, payload_key)

import type { Pool, PoolClient } from 'pg';

export interface AcquireFinalizeLockInput {
  study_id: bigint | number;
}

export type AcquireFinalizeLockResult =
  | { ok: true; conn: PoolClient }
  | { ok: false };

// acquireFinalizeLock — opens a dedicated PoolClient, BEGINs a transaction,
// and runs SELECT 1 FROM studies WHERE id=$1 AND status='aggregating'
// FOR UPDATE SKIP LOCKED.  If zero rows are returned (another aggregator
// already holds the lock, or the study is in a different state), the
// transaction is rolled back, the client is released, and ok:false is returned.
// The caller is responsible for committing or rolling back via commitReport /
// failStudy when ok:true.
export async function acquireFinalizeLock(
  pool: Pool,
  input: AcquireFinalizeLockInput,
): Promise<AcquireFinalizeLockResult> {
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    // §5.11 canonical lock query; SKIP LOCKED → zero rows if locked elsewhere.
    const result = await conn.query(
      `SELECT 1 FROM studies WHERE id = $1 AND status = 'aggregating' FOR UPDATE SKIP LOCKED`,
      [String(input.study_id)],
    );
    if (result.rowCount === 0) {
      await conn.query('ROLLBACK');
      conn.release();
      return { ok: false };
    }
    // Caller owns the connection + open transaction until they call
    // commitReport or failStudy.
    return { ok: true, conn };
  } catch (err) {
    try {
      await conn.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    conn.release();
    throw err;
  }
}

export interface ReportData {
  share_token_hash: string;
  conv_score: number;
  paired_delta_json: object;
  clusters_json?: object | null;
  scores_json?: object | null;
  paired_tests_disagreement?: boolean | null;
}

export interface CommitReportInput {
  study_id: bigint | number;
  conn: PoolClient;
  report_data: ReportData;
}

// commitReport — writes the reports row (UNIQUE study_id enforces single-writer
// correctness independent of the lock), sets studies.status='ready', and
// commits the open transaction.  Releases the PoolClient.
// Throws if INSERT fails (e.g. duplicate key on reports.study_id — that is the
// second-writer being rejected; caller should log and treat as a race loss).
export async function commitReport(input: CommitReportInput): Promise<void> {
  const { study_id, conn, report_data } = input;
  try {
    await conn.query(
      `INSERT INTO reports
         (study_id, share_token_hash, conv_score, paired_delta_json,
          clusters_json, scores_json, paired_tests_disagreement)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        String(study_id),
        report_data.share_token_hash,
        report_data.conv_score,
        JSON.stringify(report_data.paired_delta_json),
        report_data.clusters_json !== undefined && report_data.clusters_json !== null
          ? JSON.stringify(report_data.clusters_json)
          : null,
        report_data.scores_json !== undefined && report_data.scores_json !== null
          ? JSON.stringify(report_data.scores_json)
          : null,
        report_data.paired_tests_disagreement !== undefined
          ? report_data.paired_tests_disagreement
          : null,
      ],
    );
    await conn.query(
      `UPDATE studies SET status = 'ready', finalized_at = NOW() WHERE id = $1`,
      [String(study_id)],
    );
    await conn.query('COMMIT');
  } finally {
    conn.release();
  }
}

export interface FailStudyInput {
  study_id: bigint | number;
  conn: PoolClient;
  reason: string;
}

// failStudy — writes studies.status='failed' and commits.  Releases the PoolClient.
export async function failStudy(input: FailStudyInput): Promise<void> {
  const { study_id, conn } = input;
  try {
    await conn.query(
      `UPDATE studies SET status = 'failed', finalized_at = NOW() WHERE id = $1`,
      [String(study_id)],
    );
    await conn.query('COMMIT');
  } finally {
    conn.release();
  }
}

export interface RecordLateArrivalInput {
  study_id: bigint | number;
  visit_id: bigint | number;
  payload_key?: string | null;
}

// recordLateArrival — INSERT INTO late_arrivals.  Idempotent: the schema-level
// UNIQUE(study_id, visit_id) added by migration 0013 makes concurrent inserts
// of the same pair safe via ON CONFLICT DO NOTHING (issue #58).
// A late visit is one that lands after the study has reached 'ready' or
// 'failed' (spec §5.11).
// Does NOT require an open transaction; uses the pool directly.
export async function recordLateArrival(
  pool: Pool,
  input: RecordLateArrivalInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO late_arrivals (study_id, visit_id, payload_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (study_id, visit_id) DO NOTHING`,
    [
      String(input.study_id),
      String(input.visit_id),
      input.payload_key ?? null,
    ],
  );
}
