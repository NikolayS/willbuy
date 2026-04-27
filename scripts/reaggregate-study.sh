#!/usr/bin/env bash
# Force the aggregator to re-process a study that has already been finalized.
#
# Use case: an aggregator code fix lands (e.g. PR #498 — corrected role
# coercion) and you want the existing study's report_json to reflect the
# new logic without manually re-running the entire pipeline.
#
# Mechanism:
#   1. Verify the study exists and is in a terminal state ('ready' or 'failed')
#   2. DELETE the existing reports row (UNIQUE(study_id) prevents re-INSERT otherwise)
#   3. UPDATE studies SET status='aggregating' — the aggregator-trigger
#      systemd service polls for this status every 30 s and will pick it up
#   4. Print the current state and tail the trigger log so the operator
#      can confirm the new report writes successfully
#
# Run on the server (where psql + systemctl are available, and DATABASE_URL
# resolves to the local Postgres):
#
#   ssh -p 2223 root@willbuy-v01 'bash /srv/willbuy/scripts/reaggregate-study.sh 1'
#
# Or remotely via the auto-deploy SSH path:
#   gh workflow run reaggregate.yml --repo NikolayS/willbuy -f study_id=1
#   (no such workflow yet; this script is the building block.)
#
# DESTRUCTIVE: deletes the existing reports row. Re-aggregation may fail
# (status=failed), in which case the original report is gone. Acceptable
# for the dogfood study; not for production analytics traffic. Don't run
# on a study you can't afford to recompute.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <study_id>" >&2
  echo "  study_id must be an integer (current schema; see amendment A12)" >&2
  exit 2
fi

study_id="$1"
if ! [[ "$study_id" =~ ^[0-9]+$ ]]; then
  echo "ERROR: study_id must be a positive integer, got: $study_id" >&2
  exit 2
fi

# Resolve DATABASE_URL from the same place the API + workers read it.
if [[ -f /etc/willbuy/app.env ]]; then
  DATABASE_URL=$(grep ^DATABASE_URL /etc/willbuy/app.env | cut -d= -f2-)
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL not set and /etc/willbuy/app.env not readable" >&2
  exit 2
fi

# Confirm the study exists and is in a finalizable state
status=$(psql "$DATABASE_URL" --no-align --tuples-only --command \
  "SELECT status FROM studies WHERE id = $study_id" 2>/dev/null | tr -d '[:space:]' || true)

if [[ -z "$status" ]]; then
  echo "ERROR: study $study_id not found" >&2
  exit 1
fi

if [[ "$status" != "ready" && "$status" != "failed" ]]; then
  echo "ERROR: study $study_id is in status '$status' — must be 'ready' or 'failed' to re-aggregate" >&2
  echo "       In-flight studies will reach a terminal state on their own." >&2
  exit 1
fi

echo "→ Re-aggregating study $study_id (current status: $status)"

# Snapshot the existing report counts for sanity logging
existing=$(psql "$DATABASE_URL" --no-align --tuples-only --command \
  "SELECT COUNT(*) FROM reports WHERE study_id = $study_id" 2>/dev/null | tr -d '[:space:]' || echo "0")
echo "  existing reports rows: $existing"

# Atomically: delete existing report, reset study to aggregating
psql "$DATABASE_URL" <<SQL
BEGIN;
DELETE FROM reports WHERE study_id = $study_id;
UPDATE studies SET status = 'aggregating', finalized_at = NULL WHERE id = $study_id;
COMMIT;
SQL

echo "  status reset to 'aggregating' — willbuy-aggregator-trigger will pick it up within 30s"
echo
echo "Watch progress:"
echo "  journalctl -u willbuy-aggregator-trigger -f -n 20"
echo
echo "Verify success once new report row appears:"
echo "  psql \"\$DATABASE_URL\" -c \"SELECT status, finalized_at FROM studies WHERE id = $study_id\""
