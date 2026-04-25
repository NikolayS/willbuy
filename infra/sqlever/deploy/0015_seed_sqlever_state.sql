-- Deploy 0014_seed_sqlever_state
-- Spec ref: issue #48, amendment A4 — one-shot sqlever state seed.
--
-- This deploy script is a no-op when applied via `sqlever deploy` on a fresh
-- database (sqlever already tracks 0000–0013 in sqitch.changes before this
-- runs). On databases that were previously managed by the old bash migrate.sh,
-- the bash-to-sqlever transition script seeds sqitch.* from _migrations before
-- this change is ever deployed, so again this is a no-op in both cases.
--
-- What it DOES do: records its own _migrations row so the count stays
-- consistent with the .sql file count in infra/migrations/ (which the
-- test suite uses as the expected row count).

BEGIN;

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0014_seed_sqlever_state.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
