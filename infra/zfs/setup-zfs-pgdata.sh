#!/usr/bin/env bash
# infra/zfs/setup-zfs-pgdata.sh
#
# Idempotent: create ZFS pool + datasets for Postgres on willbuy-v01.
#
# Usage:
#   sudo ./setup-zfs-pgdata.sh [--check]
#
# --check  Dry-run: print what would be done but make no changes.
#
# Spec reference: SPEC.willbuy.amendments.md §A5
# Dataset layout
#   tank/willbuy/pgdata  → /var/lib/postgresql/data   (recordsize=8K)
#   tank/willbuy/pgwal   → /var/lib/postgresql/wal    (recordsize=128K, optional)
#
# DISK LAYOUT NOTE (willbuy-v01 / Hetzner CPX21):
#   The VM ships with a single 80 GB OS disk (/dev/sda).  ZFS on the raw OS
#   disk is unsafe.  Strategy for v0.1 (dev/staging only):
#     - Allocate a sparse loopback file on /var/lib/zfs-tank (up to 30 GB).
#     - v0.2 / launch: move to a Hetzner Dedicated server with separate disks
#       or a Hetzner Cloud Volume attached as /dev/sdb.
#
#   UPSIZE NOTE: CPX21 has an 80 GB SSD (README.md corrected from 40 GB spec
#   draft).  After OS + Docker layers, ~50–55 GB remains.  30 GB for the ZFS
#   loopback leaves ~20–25 GB for the OS — acceptable for v0.1.  If a Hetzner
#   Volume is attached later, replace VDEV_PATH with /dev/disk/by-id/... and
#   drop the loopback logic.
#
# Run order:
#   1. setup-zfs-pgdata.sh    ← this script
#   2. migrate-pgdata.sh      ← stop Postgres, move data, restart
#   3. install-dblab.sh       ← install DBLab Engine

set -euo pipefail

# ---------------------------------------------------------------------------
# Tunables — override via environment if needed
# ---------------------------------------------------------------------------
POOL_NAME="${POOL_NAME:-tank}"
DATASET_PGDATA="${POOL_NAME}/willbuy/pgdata"
DATASET_PGWAL="${POOL_NAME}/willbuy/pgwal"
# Mountpoints that the Supabase compose db service maps to via --volume
MOUNT_PGDATA="${MOUNT_PGDATA:-/var/lib/postgresql/data}"
MOUNT_PGWAL="${MOUNT_PGWAL:-/var/lib/postgresql/wal}"
# Loopback file used when no dedicated block device is available
VDEV_DIR="${VDEV_DIR:-/var/lib/zfs-tank}"
VDEV_FILE="${VDEV_DIR}/tank.img"
VDEV_SIZE="${VDEV_SIZE:-30G}"
# Set to an explicit block device (e.g. /dev/sdb) to skip loopback creation
VDEV_PATH="${VDEV_PATH:-}"
# Whether to create the WAL dataset (preferred but not blocking per A5)
CREATE_WAL_DATASET="${CREATE_WAL_DATASET:-yes}"

CHECK=0
for arg in "$@"; do
  if [[ "${arg}" == "--check" ]]; then
    CHECK=1
  fi
done

info()  { printf '\033[0;36m[INFO]\033[0m  %s\n' "$*"; }
warn()  { printf '\033[0;33m[WARN]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[0;32m[ OK ]\033[0m  %s\n' "$*"; }
run()   {
  if [[ "${CHECK}" -eq 1 ]]; then
    printf '\033[0;35m[DRY ]\033[0m  %s\n' "$*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# 1. Verify / install ZFS utilities
# ---------------------------------------------------------------------------
info "Checking ZFS utilities..."
if ! command -v zpool &>/dev/null || ! command -v zfs &>/dev/null; then
  warn "zfsutils-linux not found — installing..."
  run apt-get update -qq
  run apt-get install -y --no-install-recommends zfsutils-linux
else
  ok "zfsutils-linux already installed ($(zpool --version 2>/dev/null | head -1 || echo 'unknown version'))"
fi

# ---------------------------------------------------------------------------
# 2. Resolve the vdev (block device or loopback file)
# ---------------------------------------------------------------------------
if [[ -z "${VDEV_PATH}" ]]; then
  info "No explicit VDEV_PATH set — using loopback file at ${VDEV_FILE}"
  if [[ ! -d "${VDEV_DIR}" ]]; then
    run mkdir -p "${VDEV_DIR}"
  fi
  if [[ ! -f "${VDEV_FILE}" ]]; then
    info "Creating sparse loopback image (${VDEV_SIZE})..."
    run truncate -s "${VDEV_SIZE}" "${VDEV_FILE}"
  else
    ok "Loopback image already exists ($(du -sh "${VDEV_FILE}" 2>/dev/null | cut -f1 || echo '?'))"
  fi
  # Find or attach a loop device for the file
  if [[ "${CHECK}" -eq 0 ]]; then
    EXISTING_LOOP=$(losetup -j "${VDEV_FILE}" 2>/dev/null | awk -F: '{print $1}' | head -1)
    if [[ -n "${EXISTING_LOOP}" ]]; then
      VDEV_PATH="${EXISTING_LOOP}"
      ok "Loop device already attached: ${VDEV_PATH}"
    else
      VDEV_PATH=$(losetup --find --show "${VDEV_FILE}")
      ok "Attached loop device: ${VDEV_PATH}"
    fi
  else
    VDEV_PATH="/dev/loop<N>  # (would be resolved at runtime)"
  fi
else
  info "Using explicit block device: ${VDEV_PATH}"
fi

# ---------------------------------------------------------------------------
# 3. Create the ZFS pool if it does not exist
# ---------------------------------------------------------------------------
info "Checking ZFS pool '${POOL_NAME}'..."
if zpool list "${POOL_NAME}" &>/dev/null; then
  ok "Pool '${POOL_NAME}' already exists"
else
  info "Creating pool '${POOL_NAME}' on ${VDEV_PATH}..."
  run zpool create -f \
    -o ashift=12 \
    -O compression=lz4 \
    -O atime=off \
    -O relatime=off \
    -O xattr=sa \
    -O dnodesize=auto \
    -m none \
    "${POOL_NAME}" "${VDEV_PATH}"
  ok "Pool '${POOL_NAME}' created"
fi

# Ensure pool is imported (survives reboot via /etc/zfs/zpool.cache by default)
if [[ "${CHECK}" -eq 0 ]]; then
  zpool status "${POOL_NAME}" | grep -q "state: ONLINE" \
    || { warn "Pool '${POOL_NAME}' is NOT online — check 'zpool status ${POOL_NAME}'"; exit 1; }
fi

# ---------------------------------------------------------------------------
# 4. Create intermediate dataset namespace
# ---------------------------------------------------------------------------
NAMESPACE_DS="${POOL_NAME}/willbuy"
if zfs list "${NAMESPACE_DS}" &>/dev/null; then
  ok "Dataset '${NAMESPACE_DS}' already exists"
else
  info "Creating dataset '${NAMESPACE_DS}'..."
  run zfs create -o mountpoint=none "${NAMESPACE_DS}"
fi

# ---------------------------------------------------------------------------
# 5. Create tank/willbuy/pgdata with Postgres-tuned properties
# ---------------------------------------------------------------------------
info "Checking dataset '${DATASET_PGDATA}'..."
if zfs list "${DATASET_PGDATA}" &>/dev/null; then
  ok "Dataset '${DATASET_PGDATA}' already exists"
else
  info "Creating '${DATASET_PGDATA}' (recordsize=8K, lz4, atime=off, logbias=throughput, primarycache=metadata)..."
  run zfs create \
    -o recordsize=8K \
    -o compression=lz4 \
    -o atime=off \
    -o logbias=throughput \
    -o primarycache=metadata \
    -o mountpoint="${MOUNT_PGDATA}" \
    "${DATASET_PGDATA}"
  ok "Dataset '${DATASET_PGDATA}' created → ${MOUNT_PGDATA}"
fi

# ---------------------------------------------------------------------------
# 6. Optionally create tank/willbuy/pgwal (WAL — recordsize=128K)
# ---------------------------------------------------------------------------
if [[ "${CREATE_WAL_DATASET}" == "yes" ]]; then
  info "Checking WAL dataset '${DATASET_PGWAL}'..."
  if zfs list "${DATASET_PGWAL}" &>/dev/null; then
    ok "Dataset '${DATASET_PGWAL}' already exists"
  else
    info "Creating '${DATASET_PGWAL}' (recordsize=128K)..."
    run zfs create \
      -o recordsize=128K \
      -o compression=lz4 \
      -o atime=off \
      -o logbias=throughput \
      -o primarycache=all \
      -o mountpoint="${MOUNT_PGWAL}" \
      "${DATASET_PGWAL}"
    ok "Dataset '${DATASET_PGWAL}' created → ${MOUNT_PGWAL}"
  fi
else
  info "Skipping WAL dataset (CREATE_WAL_DATASET=${CREATE_WAL_DATASET})"
fi

# ---------------------------------------------------------------------------
# 7. Fix ownership so the Postgres process (uid 999) can write
#    supabase/postgres image runs as uid 999 (postgres)
# ---------------------------------------------------------------------------
if [[ "${CHECK}" -eq 0 ]]; then
  if [[ -d "${MOUNT_PGDATA}" ]]; then
    run chown -R 999:999 "${MOUNT_PGDATA}"
    ok "Ownership set on ${MOUNT_PGDATA} (uid/gid 999)"
  fi
  if [[ "${CREATE_WAL_DATASET}" == "yes" && -d "${MOUNT_PGWAL}" ]]; then
    run chown -R 999:999 "${MOUNT_PGWAL}"
    ok "Ownership set on ${MOUNT_PGWAL} (uid/gid 999)"
  fi
fi

# ---------------------------------------------------------------------------
# 8. Persist pool import across reboots via systemd zfs-import-cache
# ---------------------------------------------------------------------------
if [[ "${CHECK}" -eq 0 ]]; then
  run zpool set cachefile=/etc/zfs/zpool.cache "${POOL_NAME}"
  if [[ -f /etc/zfs/zpool.cache ]]; then
    ok "zpool.cache updated — pool will auto-import on reboot"
  fi
  # Ensure the systemd zfs-import services are enabled (Ubuntu 24.04)
  if command -v systemctl &>/dev/null; then
    run systemctl enable zfs-import-cache.service zfs-mount.service 2>/dev/null || true
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n'
info "=== ZFS setup summary ==="
if [[ "${CHECK}" -eq 0 ]]; then
  zfs list -r "${POOL_NAME}" 2>/dev/null || true
  printf '\n'
  zpool status "${POOL_NAME}" 2>/dev/null | head -6 || true
fi
ok "setup-zfs-pgdata.sh complete (--check=${CHECK})"
