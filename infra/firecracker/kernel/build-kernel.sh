#!/usr/bin/env bash
#
# build-kernel.sh — build a minimal Linux kernel suitable for Firecracker.
#
# Pinned kernel: Linux 6.6.55 (LTS, supported through Dec 2026).
#
# Why 6.6.x LTS:
#  - Firecracker's recommended host + guest kernels list 6.1 LTS and 6.6 LTS
#    (https://github.com/firecracker-microvm/firecracker/blob/main/docs/kernel-policy.md
#    — kernel-support-policy at the time of writing). 6.6 has a longer
#    upstream support window and is "current" LTS at this repo's pin date
#    2026-04-25.
#  - Stable virtio-vsock (since 4.8), virtio-blk + virtio-net rock-solid.
#  - Recent enough to ship the io_uring fixes that capture-worker's
#    Playwright/Chromium tail-latency benefits from, but old enough to be
#    proven in production microVM fleets.
#  - Spec §5.13 v0.2 requires vsock; 6.6 ships it without out-of-tree patches.
#
# Output:
#   infra/firecracker/build/vmlinux       — uncompressed bzImage-format kernel
#   stdout: KERNEL_SHA=<sha256 of vmlinux>
#
# This script is idempotent: re-running with the same KERNEL_VERSION + config
# is a no-op once the artifact exists (delete the build/ dir to force a rebuild).
#
# Usage:
#   bash build-kernel.sh              — full build (Docker required, 30+ min)
#   bash build-kernel.sh --check-only — validate the script + config syntax
#                                       (used by CI; no actual build)
#
# DO NOT run the full build on macOS — kernel cross-compilation works in
# Docker but is slow on Apple Silicon emulation. Build on Linux/willbuy-v01.

set -Eeuo pipefail
IFS=$'\n\t'

readonly KERNEL_VERSION="6.6.55"
# Tarball SHA256 is fetched from kernel.org's published sha256sums.asc at
# first build (see README "First-build SHA pin"). Recording it here as a
# pinned value would be ideal, but we don't want to bake a placeholder that
# gets out-of-date silently — the first successful willbuy-v01 build will
# open a follow-up PR with the verified value.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
readonly SCRIPT_DIR
readonly BUILD_DIR="${SCRIPT_DIR}/../build"
readonly CONFIG_FILE="${SCRIPT_DIR}/Kbuild.config"
readonly DOCKER_IMAGE="willbuy-kernel-builder:${KERNEL_VERSION}"

log() { printf '[build-kernel] %s\n' "$*" >&2; }
die() { printf '[build-kernel] ERROR: %s\n' "$*" >&2; exit 1; }

check_only() {
  log "check-only: validating script + config syntax (no build)"

  [[ -f "${CONFIG_FILE}" ]] || die "missing config: ${CONFIG_FILE}"

  # Sanity: config file must have the four virtio drivers we depend on.
  local required=(
    "CONFIG_VIRTIO=y"
    "CONFIG_VIRTIO_NET=y"
    "CONFIG_VIRTIO_BLK=y"
    "CONFIG_VIRTIO_VSOCKETS=y"
  )
  local missing=()
  local key
  for key in "${required[@]}"; do
    if ! grep -qxF "${key}" "${CONFIG_FILE}"; then
      missing+=("${key}")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    die "Kbuild.config missing required entries: ${missing[*]}"
  fi

  # Sanity: things that MUST be off (spec §2 #2 — minimal attack surface).
  local forbidden=(
    "CONFIG_MODULES=y"
    "CONFIG_DRM=y"
    "CONFIG_SOUND=y"
  )
  local found=()
  for key in "${forbidden[@]}"; do
    if grep -qxF "${key}" "${CONFIG_FILE}"; then
      found+=("${key}")
    fi
  done

  if (( ${#found[@]} > 0 )); then
    die "Kbuild.config has forbidden entries: ${found[*]}"
  fi

  # Verify bash syntax of the script itself (re-parse via bash -n).
  bash -n "${BASH_SOURCE[0]}"

  log "check-only OK: kernel pin=${KERNEL_VERSION}, config validated"
  return 0
}

ensure_docker() {
  command -v docker &>/dev/null || die "docker not on PATH; install Docker before running"
  docker info &>/dev/null || die "docker daemon not reachable"
}

build_docker_image() {
  log "building hermetic toolchain image: ${DOCKER_IMAGE}"
  docker build -t "${DOCKER_IMAGE}" - <<'DOCKERFILE'
FROM debian:bookworm-20250203-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential bc bison flex libssl-dev libelf-dev \
      ca-certificates curl xz-utils cpio kmod \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
DOCKERFILE
}

build_kernel() {
  ensure_docker
  build_docker_image

  mkdir -p "${BUILD_DIR}"

  if [[ -f "${BUILD_DIR}/vmlinux" ]]; then
    log "vmlinux already present at ${BUILD_DIR}/vmlinux — skipping (delete to rebuild)"
  else
    log "compiling Linux ${KERNEL_VERSION} (this takes 20-40 min)"
    docker run --rm \
      -v "${BUILD_DIR}:/out" \
      -v "${CONFIG_FILE}:/in/Kbuild.config:ro" \
      "${DOCKER_IMAGE}" \
      bash -Eeuo pipefail -c "
        cd /build
        curl -fsSL -o linux.tar.xz \
          'https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${KERNEL_VERSION}.tar.xz'
        tar -xf linux.tar.xz
        cd 'linux-${KERNEL_VERSION}'
        cp /in/Kbuild.config .config
        make olddefconfig
        make -j\"\$(nproc)\" vmlinux
        cp vmlinux /out/vmlinux
      "
  fi

  local sha
  sha="$(sha256sum "${BUILD_DIR}/vmlinux" | awk '{print $1}')"
  printf 'KERNEL_SHA=%s\n' "${sha}"
  printf 'KERNEL_VERSION=%s\n' "${KERNEL_VERSION}"
  printf 'OUTPUT=%s\n' "${BUILD_DIR}/vmlinux"
}

main() {
  if [[ "${1:-}" == "--check-only" ]]; then
    check_only
    return
  fi

  build_kernel
}

main "$@"
