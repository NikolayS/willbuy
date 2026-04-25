-- Deploy 0015_seed_sqlever_state
-- Spec ref: issue #48, amendment A4 + PR #91.
--
-- What this script DOES:
--   Seeds the legacy `_migrations` shadow row for 0015 so the row count
--   stays consistent with the .sql file count in infra/migrations/ (which
--   the test suite uses as the expected row count). That is the entire
--   payload — a single ON CONFLICT DO NOTHING insert into _migrations.
--
-- What this script does NOT do:
--   It does NOT seed sqlever's own state tables (sqitch.changes,
--   sqitch.events, sqitch.projects). sqlever manages those itself when
--   it deploys this change — this migration does not write to them. The
--   bash-to-sqlever state transition for previously bash-managed databases
--   is handled outside this migration (see amendment A4 transition notes).
--
-- Net effect: on a fresh DB or a DB already migrated via sqlever, this is
-- a no-op for the sqitch.* tables and a single shadow-row insert into
-- _migrations.

BEGIN;

-- sqlever-managed backward-compat row so _migrations stays in sync.
INSERT INTO _migrations (filename, checksum, applied_at)
VALUES ('0015_seed_sqlever_state.sql', 'sqlever-managed', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
