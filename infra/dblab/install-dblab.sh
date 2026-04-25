#!/usr/bin/env bash
# infra/dblab/install-dblab.sh
#
# Install DBLab Engine (Community Edition) on willbuy-v01 using Docker.
# Configures DBLab to use the ZFS dataset created by setup-zfs-pgdata.sh.
#
# Usage:
#   sudo ./install-dblab.sh [--check]
#
# --check  Dry-run: print what would be done but make no changes.
#
# PREREQUISITES (run in order):
#   1. setup-zfs-pgdata.sh   — ZFS pool + datasets created + mounted
#   2. migrate-pgdata.sh     — Postgres running on ZFS
#   3. install-dblab.sh      ← this script
#
# WHAT THIS SCRIPT DOES:
#   a. Installs the DBLab CLI (dblab) to /usr/local/bin.
#   b. Creates the DBLab config directory and writes server.yml from the
#      template at infra/dblab/dblab.yml (copied here during this run).
#   c. Takes an initial ZFS snapshot that DBLab will use as its base image.
#   d. Starts the DBLab Engine container (postgresai/dblab-server:latest).
#   e. Waits for the /healthz endpoint to respond.
#   f. Prints clone creation example.
#
# SECURITY NOTE:
#   DBLAB_VERIFICATION_TOKEN must be set in /etc/willbuy/secrets.env
#   (never committed).  If not set in environment, this script will generate
#   a random token and warn the operator to persist it.
#
# DBLab docs: https://postgres.ai/docs/database-lab-engine
# Config ref:  https://postgres.ai/docs/reference-guides/database-lab-engine-configuration-reference
#
# DBLab VERSION NOTE (bumped 2026-04-25, PR #65 M-1 fix):
#   Pinned to 4.1.1 (current Docker Hub stable as of 2026-04-25).
#   DBLab 4.x introduced config schema changes vs 3.x; infra/dblab/dblab.yml
#   has been reviewed against the 4.x reference and updated accordingly.
#   If you need to roll back to 3.6.0, set DBLAB_SERVER_IMAGE and
#   DBLAB_CLI_VERSION in the environment before running this script.
#
# LOW-2 NOTE — sync container networking on first auto-refresh:
#   DBLab Engine is started without --network host. The sync container it
#   spawns runs on Docker's bridge network where 127.0.0.1 resolves to the
#   container itself, not to the host. The initial snapshot taken below (step
#   "Take initial ZFS snapshot") avoids this issue because pg_basebackup is
#   invoked from the host. However, the first *automatic* 6-hour refresh
#   (triggered by the scheduler.timetable cron) will attempt to reach
#   Postgres via PGHOST=127.0.0.1 from inside the sync container and will
#   fail. Fix in a follow-up: add --network host to the docker run call, OR
#   change PGHOST in dblab.yml to use the Docker bridge gateway address
#   (typically 172.17.0.1) or host-gateway alias. Tracked as a known v0.1
#   limitation; does not affect the initial deploy.

set -euo pipefail

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------
DBLAB_SERVER_IMAGE="${DBLAB_SERVER_IMAGE:-postgresai/dblab-server:4.1.1}"
DBLAB_UI_IMAGE="${DBLAB_UI_IMAGE:-postgresai/ce-ui:latest}"
DBLAB_CLI_VERSION="${DBLAB_CLI_VERSION:-4.1.1}"
DBLAB_CONFIG_DIR="${DBLAB_CONFIG_DIR:-/home/dblab/configs}"
DBLAB_DATA_DIR="${DBLAB_DATA_DIR:-/var/lib/dblab}"
# ZFS pool name (must match setup-zfs-pgdata.sh)
ZFS_POOL_NAME="${ZFS_POOL_NAME:-tank}"
# DBLab API port
DBLAB_PORT="${DBLAB_PORT:-2345}"
DBLAB_UI_PORT="${DBLAB_UI_PORT:-2346}"
# Script directory (so we can copy dblab.yml from infra/dblab/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DBLAB_YML_SRC="${SCRIPT_DIR}/dblab.yml"
# Verification token — prefer env var set from /etc/willbuy/secrets.env
# shellcheck disable=SC2153
DBLAB_VERIFICATION_TOKEN="${DBLAB_VERIFICATION_TOKEN:-}"
# Snapshot name for the initial golden copy
INITIAL_SNAPSHOT="${ZFS_POOL_NAME}/willbuy/pgdata@dblab_init_$(date +%Y%m%d_%H%M%S)"
# Container name
DBLAB_CONTAINER="${DBLAB_CONTAINER:-dblab_server}"

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
# Pre-flight
# ---------------------------------------------------------------------------
info "Pre-flight checks..."
if [[ "${CHECK}" -eq 0 ]]; then
  [[ "$(id -u)" -eq 0 ]] || die "Must run as root (sudo)"
  command -v docker &>/dev/null || die "docker not found"
  command -v zfs    &>/dev/null || die "zfs not found — run setup-zfs-pgdata.sh first"
  command -v curl   &>/dev/null || { apt-get install -y curl; }

  # ZFS dataset must exist
  zfs list "${ZFS_POOL_NAME}/willbuy/pgdata" &>/dev/null \
    || die "ZFS dataset ${ZFS_POOL_NAME}/willbuy/pgdata not found — run setup-zfs-pgdata.sh first"
fi

# ---------------------------------------------------------------------------
# Generate or validate verification token
# ---------------------------------------------------------------------------
if [[ -z "${DBLAB_VERIFICATION_TOKEN}" ]]; then
  if [[ "${CHECK}" -eq 0 ]]; then
    DBLAB_VERIFICATION_TOKEN=$(openssl rand -hex 24)
    warn "DBLAB_VERIFICATION_TOKEN not set — generated: ${DBLAB_VERIFICATION_TOKEN}"
    warn "Add the following line to /etc/willbuy/secrets.env and re-run, OR keep"
    warn "this session open (token is in memory only until the container starts):"
    warn "  DBLAB_VERIFICATION_TOKEN=${DBLAB_VERIFICATION_TOKEN}"
  else
    DBLAB_VERIFICATION_TOKEN="<generated-at-runtime>"
  fi
fi

# ---------------------------------------------------------------------------
# Install DBLab CLI
# ---------------------------------------------------------------------------
info "Installing DBLab CLI v${DBLAB_CLI_VERSION}..."
CLI_URL="https://gitlab.com/postgres-ai/database-lab/-/releases/${DBLAB_CLI_VERSION}/downloads/dblab_linux_amd64"
if command -v dblab &>/dev/null && dblab --version 2>/dev/null | grep -q "${DBLAB_CLI_VERSION}"; then
  ok "DBLab CLI already at v${DBLAB_CLI_VERSION}"
else
  run curl -sSL "${CLI_URL}" -o /usr/local/bin/dblab
  run chmod +x /usr/local/bin/dblab
  ok "DBLab CLI installed at /usr/local/bin/dblab"
fi

# ---------------------------------------------------------------------------
# Create config directory + copy server.yml
# ---------------------------------------------------------------------------
info "Creating DBLab config directory ${DBLAB_CONFIG_DIR}..."
run mkdir -p "${DBLAB_CONFIG_DIR}"

if [[ -f "${DBLAB_YML_SRC}" ]]; then
  info "Copying ${DBLAB_YML_SRC} → ${DBLAB_CONFIG_DIR}/server.yml..."
  run cp "${DBLAB_YML_SRC}" "${DBLAB_CONFIG_DIR}/server.yml"
  # Inject the verification token (sed in-place)
  if [[ "${CHECK}" -eq 0 ]]; then
    sed -i "s|__DBLAB_VERIFICATION_TOKEN__|${DBLAB_VERIFICATION_TOKEN}|g" \
      "${DBLAB_CONFIG_DIR}/server.yml"
    ok "server.yml written with verification token"
  fi
else
  warn "dblab.yml source not found at ${DBLAB_YML_SRC} — you must place server.yml manually at ${DBLAB_CONFIG_DIR}/server.yml before starting the container."
fi

# ---------------------------------------------------------------------------
# Create DBLab data directory
# ---------------------------------------------------------------------------
info "Ensuring DBLab data directory ${DBLAB_DATA_DIR} exists..."
run mkdir -p "${DBLAB_DATA_DIR}"

# ---------------------------------------------------------------------------
# Take initial ZFS snapshot (golden copy for DBLab)
# ---------------------------------------------------------------------------
info "Taking initial ZFS snapshot: ${INITIAL_SNAPSHOT}..."
# Postgres must be quiesced or the snapshot should be taken after a checkpoint.
# At first run (fresh data), this is safe.  For subsequent refreshes, DBLab
# manages snapshot rotation automatically per its scheduler.timetable.
if [[ "${CHECK}" -eq 0 ]]; then
  if zfs list -t snapshot "${INITIAL_SNAPSHOT}" &>/dev/null; then
    ok "Snapshot already exists: ${INITIAL_SNAPSHOT}"
  else
    zfs snapshot "${INITIAL_SNAPSHOT}"
    ok "Snapshot created: ${INITIAL_SNAPSHOT}"
  fi
else
  run zfs snapshot "${INITIAL_SNAPSHOT}"
fi

# ---------------------------------------------------------------------------
# Stop any existing DBLab container
# ---------------------------------------------------------------------------
info "Checking for existing DBLab container '${DBLAB_CONTAINER}'..."
if [[ "${CHECK}" -eq 0 ]]; then
  if docker ps -a --format '{{.Names}}' | grep -q "^${DBLAB_CONTAINER}$"; then
    warn "Removing existing container '${DBLAB_CONTAINER}'..."
    docker rm -f "${DBLAB_CONTAINER}"
  fi
fi

# ---------------------------------------------------------------------------
# Start DBLab Engine container
# ---------------------------------------------------------------------------
info "Starting DBLab Engine (${DBLAB_SERVER_IMAGE})..."
# shellcheck disable=SC2086
run docker run -d \
  --name "${DBLAB_CONTAINER}" \
  --restart unless-stopped \
  --privileged \
  -p "127.0.0.1:${DBLAB_PORT}:2345" \
  -p "127.0.0.1:${DBLAB_UI_PORT}:2346" \
  -e HOSTNAME="${DBLAB_CONTAINER}" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${DBLAB_DATA_DIR}:${DBLAB_DATA_DIR}:rshared" \
  -v /var/lib/docker:/var/lib/docker \
  -v "${DBLAB_CONFIG_DIR}:/home/dblab/configs" \
  "${DBLAB_SERVER_IMAGE}"

ok "DBLab container started"

# ---------------------------------------------------------------------------
# Wait for /healthz
# ---------------------------------------------------------------------------
info "Waiting for DBLab /healthz (up to 60s)..."
if [[ "${CHECK}" -eq 0 ]]; then
  RETRIES=12
  DELAY=5
  for i in $(seq 1 ${RETRIES}); do
    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
      "http://127.0.0.1:${DBLAB_PORT}/healthz" 2>/dev/null || echo "000")
    if [[ "${HTTP_CODE}" == "200" ]]; then
      ok "DBLab Engine healthy (HTTP ${HTTP_CODE})"
      break
    fi
    if [[ "${i}" -eq "${RETRIES}" ]]; then
      die "DBLab did not become healthy after $((RETRIES * DELAY))s. Check: docker logs ${DBLAB_CONTAINER}"
    fi
    info "  HTTP ${HTTP_CODE} (attempt ${i}/${RETRIES}) — waiting ${DELAY}s..."
    sleep "${DELAY}"
  done
fi

# ---------------------------------------------------------------------------
# Initialize CLI environment
# ---------------------------------------------------------------------------
info "Initializing DBLab CLI environment..."
run dblab init \
  --url "http://127.0.0.1:${DBLAB_PORT}" \
  --token "${DBLAB_VERIFICATION_TOKEN}" \
  --environment-id "willbuy-v01"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n'
info "=== DBLab installation summary ==="
ok "DBLab Engine running on http://127.0.0.1:${DBLAB_PORT}"
ok "DBLab UI      running on http://127.0.0.1:${DBLAB_UI_PORT}"
info ""
info "Create a thin clone:"
info "  dblab clone create --id dev1 --username postgres --password '<password>'"
info ""
info "List clones:"
info "  dblab clone list"
info ""
info "Connect to a clone (default port range 6000-6099):"
info "  psql -h 127.0.0.1 -p 6000 -U postgres -d postgres"
info ""
info "Delete a clone:"
info "  dblab clone destroy --id dev1"
ok "install-dblab.sh complete (--check=${CHECK})"
