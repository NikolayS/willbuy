#!/usr/bin/env bash
#
# build-rootfs.sh — assemble the Firecracker guest rootfs as a raw ext4 image.
#
# Pipeline:
#   1. `docker build` the rootfs Dockerfile.
#   2. `docker export` the resulting filesystem tree to a tarball.
#   3. `mkfs.ext4 -d <tree>` writes the tree into a raw ext4 image at a size
#      computed from the tree's `du -sb` plus a 20% slack.
#   4. `gzip -9` the image.
#
# Output:
#   infra/firecracker/build/rootfs.ext4.gz
#   stdout: ROOTFS_SHA, ROOTFS_BYTES_RAW, ROOTFS_BYTES_GZ
#
# Why we use mkfs.ext4 -d (and not loopback mount + cp -a):
#   `-d <directory>` lands the entire tree atomically without needing
#   loop-mount privileges. Works in CI containers where loop devices
#   may not be available. Available since e2fsprogs 1.43 (2016).
#
# This script is idempotent: re-running with the same Dockerfile + capture-
# worker source is a no-op once the artifact exists (delete the build/ dir
# to force a rebuild).
#
# Usage:
#   bash build-rootfs.sh              — full build (Docker required)
#   bash build-rootfs.sh --check-only — validate the script syntax (CI)

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." &>/dev/null && pwd)"
readonly REPO_ROOT
readonly BUILD_DIR="${REPO_ROOT}/infra/firecracker/build"
readonly DOCKERFILE="${SCRIPT_DIR}/Dockerfile"
readonly DOCKER_IMAGE="willbuy-fc-rootfs:dev"
readonly OUTPUT_RAW="${BUILD_DIR}/rootfs.ext4"
readonly OUTPUT_GZ="${BUILD_DIR}/rootfs.ext4.gz"
readonly ROOTFS_BUDGET_BYTES=$(( 1024 * 1024 * 1024 ))  # 1 GiB compressed cap

log() { printf '[build-rootfs] %s\n' "$*" >&2; }
die() { printf '[build-rootfs] ERROR: %s\n' "$*" >&2; exit 1; }

check_only() {
  log "check-only: validating script syntax (no build)"
  bash -n "${BASH_SOURCE[0]}"
  [[ -f "${DOCKERFILE}" ]] || die "missing Dockerfile: ${DOCKERFILE}"
  [[ -f "${SCRIPT_DIR}/init.sh" ]] || die "missing init.sh"
  log "check-only OK"
  return 0
}

ensure_tools() {
  command -v docker &>/dev/null || die "docker not on PATH"
  docker info &>/dev/null || die "docker daemon not reachable"
  command -v mkfs.ext4 &>/dev/null || die "mkfs.ext4 not on PATH (apt install e2fsprogs)"
  command -v gzip &>/dev/null || die "gzip not on PATH"
}

build_image() {
  log "building rootfs Docker image: ${DOCKER_IMAGE}"
  docker build \
    -f "${DOCKERFILE}" \
    -t "${DOCKER_IMAGE}" \
    "${REPO_ROOT}"
}

export_tree() {
  local stage="$1"
  log "exporting filesystem tree to ${stage}"
  local cid
  cid="$(docker create "${DOCKER_IMAGE}")"
  trap 'docker rm -f "${cid}" &>/dev/null || true' RETURN
  mkdir -p "${stage}"
  docker export "${cid}" | tar -x -C "${stage}"
  docker rm -f "${cid}" &>/dev/null || true
}

build_ext4() {
  local stage="$1"
  local raw_size used_bytes target_bytes
  used_bytes="$(du -sb "${stage}" | awk '{print $1}')"
  # 20% slack + 64 MiB headroom for filesystem metadata / runtime tmpfs is
  # excessive but cheap (compressed image is what we care about).
  target_bytes=$(( used_bytes * 120 / 100 + 64 * 1024 * 1024 ))
  raw_size="$(( target_bytes / 1024 / 1024 ))M"

  log "creating raw ext4 image: ${OUTPUT_RAW} (size: ${raw_size}, content: $(numfmt --to=iec "${used_bytes}"))"
  rm -f "${OUTPUT_RAW}"
  truncate -s "${raw_size}" "${OUTPUT_RAW}"
  mkfs.ext4 -F -L willbuy-rootfs -d "${stage}" "${OUTPUT_RAW}" >/dev/null
}

compress() {
  log "compressing with gzip -9"
  rm -f "${OUTPUT_GZ}"
  gzip -9 -k "${OUTPUT_RAW}"
}

verify_budget() {
  local gz_bytes
  gz_bytes="$(stat -c '%s' "${OUTPUT_GZ}" 2>/dev/null || stat -f '%z' "${OUTPUT_GZ}")"
  if (( gz_bytes > ROOTFS_BUDGET_BYTES )); then
    die "rootfs over budget: ${gz_bytes} bytes > ${ROOTFS_BUDGET_BYTES} bytes (1 GiB)"
  fi
  log "rootfs size OK: $(numfmt --to=iec "${gz_bytes}") <= 1 GiB"
}

emit_summary() {
  local sha raw_bytes gz_bytes
  sha="$(sha256sum "${OUTPUT_GZ}" | awk '{print $1}')"
  raw_bytes="$(stat -c '%s' "${OUTPUT_RAW}" 2>/dev/null || stat -f '%z' "${OUTPUT_RAW}")"
  gz_bytes="$(stat -c '%s' "${OUTPUT_GZ}" 2>/dev/null || stat -f '%z' "${OUTPUT_GZ}")"
  printf 'ROOTFS_SHA=%s\n' "${sha}"
  printf 'ROOTFS_BYTES_RAW=%s\n' "${raw_bytes}"
  printf 'ROOTFS_BYTES_GZ=%s\n'  "${gz_bytes}"
  printf 'OUTPUT=%s\n' "${OUTPUT_GZ}"
}

build_rootfs() {
  ensure_tools
  mkdir -p "${BUILD_DIR}"

  if [[ -f "${OUTPUT_GZ}" ]]; then
    log "${OUTPUT_GZ} already present — skipping (delete to rebuild)"
    emit_summary
    return
  fi

  build_image

  local stage
  stage="$(mktemp -d -t willbuy-fc-rootfs.XXXXXX)"
  trap 'rm -rf "${stage}"' EXIT

  export_tree "${stage}"
  build_ext4 "${stage}"
  compress
  verify_budget
  emit_summary
}

main() {
  if [[ "${1:-}" == "--check-only" ]]; then
    check_only
    return
  fi

  build_rootfs
}

main "$@"
