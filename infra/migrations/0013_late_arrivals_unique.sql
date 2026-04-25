-- 0012_late_arrivals_unique.sql — schema-enforce idempotency on late_arrivals.
--
-- Issue #58: add UNIQUE(study_id, visit_id) so concurrent recordLateArrival
-- calls cannot produce duplicate rows. The application-level WHERE NOT EXISTS
-- guard in aggregator-lock.ts::recordLateArrival is replaced with a plain
-- INSERT … ON CONFLICT DO NOTHING after this migration runs.
--
-- The constraint is added concurrently-safe with IF NOT EXISTS; migration is
-- idempotent on re-run.

alter table late_arrivals
  add constraint late_arrivals_study_id_visit_id_key
  unique (study_id, visit_id);
