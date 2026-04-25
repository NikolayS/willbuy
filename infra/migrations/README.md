# willbuy migrations — historical reference

These files are HISTORICAL REFERENCE ONLY. The operative source for
schema migrations is `infra/sqlever/deploy/` (per amendment A4 + PR #91).

To add a new migration, run:
  bun run scripts/next-migration.sh <slug>

This creates files in BOTH dirs and prints a sqitch.plan reminder. Do NOT
modify files here directly — modify the corresponding `infra/sqlever/deploy/`
script instead.

The pre-commit / CI guard (PR #101 / scripts/check-migrations.sh) will fail
if these dirs drift.
