/**
 * `page_captures` row writer abstraction. Production wires this to a
 * Postgres client. Tests pass `inMemoryCaptureStore()`. CI never touches
 * a live database (per issue #32 coordination note).
 */

import { Pool } from 'pg';

export type PageCaptureRow = {
  capture_id: string;
  status: 'ok' | 'blocked' | 'error';
  a11y_object_key: string;
  screenshot_object_key: string | null;
  banner_selectors_matched: string[];
  overlays_unknown_present: boolean;
  blocked_reason: string | null;
  host_count: number;
  breach_reason: string | null;
  redactor_v: number;
  created_at: string;
  /** FK to studies(id); required for pgCaptureStore; absent in smoke/test paths. */
  study_id?: number;
  /** Salted SHA-256 of the captured URL (spec §5.12); required for pgCaptureStore. */
  url_hash?: string;
};

export type CaptureInsertResult = {
  /** Bigint PK of the inserted page_captures row; 0 for in-memory store. */
  id: number;
};

export type CaptureStore = {
  insert(row: PageCaptureRow): Promise<CaptureInsertResult>;
};

export function inMemoryCaptureStore(): CaptureStore & {
  rows(): PageCaptureRow[];
} {
  const all: PageCaptureRow[] = [];
  return {
    async insert(row) {
      all.push(row);
      return { id: 0 };
    },
    rows() {
      return [...all];
    },
  };
}

/**
 * Production Postgres implementation of CaptureStore.
 *
 * Maps PageCaptureRow fields to the actual `page_captures` table columns
 * (0003_page_captures.sql). Returns the generated `id` bigint PK via
 * RETURNING so the caller can propagate it to `visits.capture_id`.
 *
 * Requires `row.study_id` and `row.url_hash` to be present; throws if absent
 * (both are NOT NULL in the DB and are always sent by the capture-worker in
 * production — only the smoke probe omits them, which uses inMemoryCaptureStore).
 */
export function pgCaptureStore(pool: Pool): CaptureStore {
  return {
    async insert(row: PageCaptureRow): Promise<CaptureInsertResult> {
      if (row.study_id === undefined || row.study_id === null) {
        throw new Error('pgCaptureStore: row.study_id is required');
      }
      if (row.url_hash === undefined || row.url_hash === null) {
        throw new Error('pgCaptureStore: row.url_hash is required');
      }

      const result = await pool.query<{ id: string }>(
        `INSERT INTO page_captures
           (study_id, url_hash, a11y_storage_key, screenshot_storage_key,
            host_count, status, breach_reason, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (study_id, (COALESCE(side, ''::text)))
           DO UPDATE SET
             a11y_storage_key       = EXCLUDED.a11y_storage_key,
             screenshot_storage_key = EXCLUDED.screenshot_storage_key,
             url_hash               = EXCLUDED.url_hash,
             host_count             = EXCLUDED.host_count,
             status                 = EXCLUDED.status,
             breach_reason          = EXCLUDED.breach_reason,
             captured_at            = EXCLUDED.captured_at
         RETURNING id`,
        [
          row.study_id,
          row.url_hash,
          row.a11y_object_key,
          row.screenshot_object_key,
          row.host_count,
          row.status,
          row.breach_reason,
          row.created_at,
        ],
      );

      const id = Number(result.rows[0]!.id);
      return { id };
    },
  };
}
