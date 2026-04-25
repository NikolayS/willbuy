-- Deploy 0013_late_arrivals_unique
-- Spec ref: issue #58 — schema-enforce idempotency on late_arrivals.

BEGIN;

-- 0013_late_arrivals_unique.sql — schema-enforce idempotency on late_arrivals.
--
-- Issue #58: add UNIQUE(study_id, visit_id) so concurrent recordLateArrival
-- calls cannot produce duplicate rows. The application-level WHERE NOT EXISTS
-- guard in aggregator-lock.ts::recordLateArrival is replaced with a plain
-- INSERT … ON CONFLICT DO NOTHING after this migration runs.
--
-- The constraint is enforced via a unique index (IF NOT EXISTS), making this
-- migration idempotent on re-run: a second execution is a no-op.
-- migrate.sh's tracking table prevents re-runs under normal operation; the
-- IF NOT EXISTS guard protects against manual re-application outside that flow.

create unique index if not exists late_arrivals_study_id_visit_id_key
  on late_arrivals (study_id, visit_id);

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0013_late_arrivals_unique.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
