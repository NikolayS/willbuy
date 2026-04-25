#!/usr/bin/env bash
# infra/zfs/migrate-pgdata.sh
#
# Migrate the existing Supabase Postgres PGDATA into the ZFS dataset created
# by setup-zfs-pgdata.sh, then restart the stack and verify connectivity.
#
# Usage:
#   sudo ./migrate-pgdata.sh [--check]
#
# --check  Dry-run: print what would be done but make no changes.
#
# PREREQUISITES:
#   - setup-zfs-pgdata.sh has been run and the ZFS dataset is mounted.
#   - Docker Compose Supabase stack is running at COMPOSE_FILE.
#   - jq is installed.
#
# MIGRATION STRATEGY:
#   The database is in Sprint 2 / early dev state — no production data.
#   We use the simplest safe approach:
#     1. docker compose down  (stops all containers cleanly)
#     2. rsync PGDATA from old Docker volume → ZFS mount
#     3. Update the db service volume binding in an override file
#     4. docker compose up -d
#     5. pg_isready + schema integrity check
#
#   For production migrations with real data, prefer pg_basebackup or
#   "rsync with Postgres in hot-standby + final sync", but that is overkill
#   for this stage.
#
# ROLLBACK:
#   If the migration fails after step 3, bring the stack up again with the
#   original compose file (no override) — the old volume is untouched.
#
# Run order:
#   1. setup-zfs-pgdata.sh
#   2. migrate-pgdata.sh       ← this script
#   3. install-dblab.sh

set -euo pipefail

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------
COMPOSE_FILE="${COMPOSE_FILE:-/srv/willbuy/infra/dev/docker-compose.yml}"
COMPOSE_ENV="${COMPOSE_ENV:-/srv/willbuy/infra/dev/.env}"
# Override file that rebinds the db volume to ZFS; created by this script
COMPOSE_OVERRIDE="${COMPOSE_OVERRIDE:-/srv/willbuy/infra/dev/docker-compose.zfs.yml}"
# Where the Supabase db container keeps its data inside the Docker-managed volume
# (default Docker volume location on Ubuntu)
DOCKER_VOLUME_BASE="${DOCKER_VOLUME_BASE:-/var/lib/docker/volumes}"
# Volume name used in the compose file (volumes.db-data key)
DOCKER_VOLUME_NAME="${DOCKER_VOLUME_NAME:-dev_db-data}"
# ZFS mount created by setup-zfs-pgdata.sh
ZFS_PGDATA_MOUNT="${ZFS_PGDATA_MOUNT:-/var/lib/postgresql/data}"
# Postgres connection used for post-migration health check
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-54322}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-postgres}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-dev}"

CHECK=0
for arg in "$@"; do
  if [[ "${arg}" == "--check" ]]; then
    CHECK=1
  fi
done

info()  { printf '\033[0;36m[INFO]\033[0m  %s\n' "$*"; }
warn()  { printf '\033[0;33m[WARN]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[0;32m[ OK ]\033[0m  %s\n' "$*"; }
die()   { printf '\033[0;31m[FAIL]\033[0m  %s\n' "$*"; exit 1; }
run()   {
  if [[ "${CHECK}" -eq 1 ]]; then
    printf '\033[0;35m[DRY ]\033[0m  %s\n' "$*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
info "Pre-flight checks..."

if [[ "${CHECK}" -eq 0 ]]; then
  [[ "$(id -u)" -eq 0 ]] || die "Must run as root (sudo)"

  command -v docker &>/dev/null || die "docker not found"
  command -v rsync  &>/dev/null || { warn "rsync not found — installing..."; apt-get install -y rsync; }

  [[ -f "${COMPOSE_FILE}" ]] || die "Compose file not found: ${COMPOSE_FILE}"
  [[ -f "${COMPOSE_ENV}"  ]] || die "Compose env file not found: ${COMPOSE_ENV}"

  # ZFS dataset must be mounted
  mountpoint -q "${ZFS_PGDATA_MOUNT}" \
    || die "ZFS mount not found at ${ZFS_PGDATA_MOUNT}. Run setup-zfs-pgdata.sh first."

  # Determine the old volume path
  OLD_PGDATA="${DOCKER_VOLUME_BASE}/${DOCKER_VOLUME_NAME}/_data"
  [[ -d "${OLD_PGDATA}" ]] \
    || die "Old PGDATA not found at ${OLD_PGDATA}. Is the volume name correct? (DOCKER_VOLUME_NAME=${DOCKER_VOLUME_NAME})"
fi

# ---------------------------------------------------------------------------
# Disk space sanity check
# ---------------------------------------------------------------------------
info "Disk usage before migration:"
if [[ "${CHECK}" -eq 0 ]]; then
  df -h "${ZFS_PGDATA_MOUNT}" | tail -1 || true
  OLD_PGDATA="${DOCKER_VOLUME_BASE}/${DOCKER_VOLUME_NAME}/_data"
  PGDATA_SIZE=$(du -sh "${OLD_PGDATA}" 2>/dev/null | cut -f1 || echo "unknown")
  info "  Source PGDATA size: ${PGDATA_SIZE}"
  info "  Destination mount: ${ZFS_PGDATA_MOUNT}"
fi

# ---------------------------------------------------------------------------
# Step 1: Stop the Supabase stack
# ---------------------------------------------------------------------------
info "Step 1: Stopping Supabase docker-compose stack..."
run docker compose \
  -f "${COMPOSE_FILE}" \
  --env-file "${COMPOSE_ENV}" \
  -p "${COMPOSE_PROJECT}" \
  down

if [[ "${CHECK}" -eq 0 ]]; then
  ok "Stack stopped"
fi

# ---------------------------------------------------------------------------
# Step 2: rsync PGDATA to ZFS mount
# ---------------------------------------------------------------------------
if [[ "${CHECK}" -eq 0 ]]; then
  OLD_PGDATA="${DOCKER_VOLUME_BASE}/${DOCKER_VOLUME_NAME}/_data"
fi
info "Step 2: rsyncing PGDATA → ZFS mount..."
info "  Source: ${OLD_PGDATA:-${DOCKER_VOLUME_BASE}/${DOCKER_VOLUME_NAME}/_data}"
info "  Destination: ${ZFS_PGDATA_MOUNT}/"

run rsync \
  --archive \
  --hard-links \
  --sparse \
  --delete \
  --info=progress2 \
  "${OLD_PGDATA:-/var/lib/docker/volumes/dev_db-data/_data}/" \
  "${ZFS_PGDATA_MOUNT}/"

if [[ "${CHECK}" -eq 0 ]]; then
  ok "rsync complete"
  # Ensure correct ownership for supabase/postgres (uid 999)
  chown -R 999:999 "${ZFS_PGDATA_MOUNT}"
  ok "Ownership corrected to 999:999"
fi

# ---------------------------------------------------------------------------
# Step 3: Write docker-compose override that binds db to ZFS mount
# ---------------------------------------------------------------------------
info "Step 3: Writing compose override → ${COMPOSE_OVERRIDE}..."
# shellcheck disable=SC2086
# The override replaces the db-data named volume with a bind-mount to ZFS.
run tee "${COMPOSE_OVERRIDE}" > /dev/null <<'OVERRIDE'
# docker-compose.zfs.yml — generated by migrate-pgdata.sh
# This override replaces the named "db-data" volume with a direct bind-mount
# to the ZFS dataset at /var/lib/postgresql/data.
#
# Usage: docker compose -f docker-compose.yml -f docker-compose.zfs.yml --env-file .env up -d
services:
  db:
    volumes:
      - /var/lib/postgresql/data:/var/lib/postgresql/data
OVERRIDE

if [[ "${CHECK}" -eq 0 ]]; then
  ok "Override file written: ${COMPOSE_OVERRIDE}"
fi

# ---------------------------------------------------------------------------
# Step 4: Start Supabase stack with ZFS volume override
# ---------------------------------------------------------------------------
info "Step 4: Starting Supabase stack with ZFS override..."
run docker compose \
  -f "${COMPOSE_FILE}" \
  -f "${COMPOSE_OVERRIDE}" \
  --env-file "${COMPOSE_ENV}" \
  -p "${COMPOSE_PROJECT}" \
  up -d

if [[ "${CHECK}" -eq 0 ]]; then
  ok "Stack started with ZFS volume binding"
fi

# ---------------------------------------------------------------------------
# Step 5: Verify Postgres connectivity + schema integrity
# ---------------------------------------------------------------------------
info "Step 5: Waiting for Postgres to become ready (up to 60s)..."
if [[ "${CHECK}" -eq 0 ]]; then
  RETRIES=12
  DELAY=5
  for i in $(seq 1 ${RETRIES}); do
    if docker compose \
        -f "${COMPOSE_FILE}" \
        -f "${COMPOSE_OVERRIDE}" \
        --env-file "${COMPOSE_ENV}" \
        -p "${COMPOSE_PROJECT}" \
        exec -T db \
        pg_isready -U "${PG_USER}" -d "${PG_DB}" &>/dev/null; then
      ok "Postgres is ready (attempt ${i})"
      break
    fi
    if [[ "${i}" -eq "${RETRIES}" ]]; then
      die "Postgres did not become ready after $((RETRIES * DELAY))s. Check: docker compose logs db"
    fi
    info "  Not ready yet (attempt ${i}/${RETRIES}) — waiting ${DELAY}s..."
    sleep "${DELAY}"
  done

  # Schema integrity check: confirm _migrations table exists (created in Sprint 2)
  info "Checking schema integrity (_migrations table)..."
  TABLE_COUNT=$(docker compose \
    -f "${COMPOSE_FILE}" \
    -f "${COMPOSE_OVERRIDE}" \
    --env-file "${COMPOSE_ENV}" \
    -p "${COMPOSE_PROJECT}" \
    exec -T db \
    psql -U "${PG_USER}" -d "${PG_DB}" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_name = '_migrations';" 2>/dev/null || echo "0")
  if [[ "${TABLE_COUNT}" -gt 0 ]]; then
    ok "_migrations table found — schema intact"
  else
    warn "_migrations table not found. If this is a fresh DB (no migrations applied yet), that is expected."
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n'
info "=== Migration summary ==="
ok "PGDATA migrated to ZFS dataset."
info "  ZFS mount:     ${ZFS_PGDATA_MOUNT}"
info "  Override file: ${COMPOSE_OVERRIDE}"
info ""
info "To start the stack in future:"
info "  docker compose -f ${COMPOSE_FILE} -f ${COMPOSE_OVERRIDE} --env-file ${COMPOSE_ENV} up -d"
info ""
info "Old Docker volume (${DOCKER_VOLUME_NAME}) is still present and can be removed"
info "once you have confirmed the new ZFS-backed Postgres is healthy:"
info "  docker volume rm ${DOCKER_VOLUME_NAME}"
ok "migrate-pgdata.sh complete (--check=${CHECK})"
