-- Deploy 0000_init
-- Spec ref: §4.1 placeholder. Creates the _migrations backward-compat tracking table.

BEGIN;

-- 0000_init.sql — placeholder migration. Real schema lands in #26.
--
-- Creates the migration tracking table the runner relies on. The runner
-- (scripts/migrate.sh) creates this table on its own first invocation too
-- (CREATE TABLE IF NOT EXISTS) — defining it here keeps the SQL surface
-- self-describing and lets a DBA run migrations by hand if the runner
-- is unavailable.
CREATE TABLE IF NOT EXISTS _migrations (
  filename     TEXT        PRIMARY KEY,
  checksum     TEXT        NOT NULL,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0000_init.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
