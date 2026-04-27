#!/usr/bin/env bash
# willbuy-aggregator-trigger.sh
#
# Polls for studies in `aggregating` status and runs the aggregator Docker
# container for each one. Loaded into the environment by
# willbuy-aggregator-trigger.service via EnvironmentFile=/etc/willbuy/app.env,
# so DATABASE_URL is available at runtime.
#
# Runs as an infinite loop; systemd Restart=on-failure handles crashes.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[aggregator-trigger] ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

echo "[aggregator-trigger] starting poll loop"

while true; do
  study_id=$(psql "$DATABASE_URL" --no-align --tuples-only --command \
    "SELECT id FROM studies WHERE status='aggregating' ORDER BY created_at ASC LIMIT 1" \
    2>/dev/null || true)

  if [[ -n "$study_id" ]]; then
    echo "[aggregator-trigger] running aggregator for study $study_id"
    docker run --rm \
      --env DATABASE_URL="$DATABASE_URL" \
      willbuy-aggregator \
      --study-id "$study_id"
  fi

  sleep 30
done
