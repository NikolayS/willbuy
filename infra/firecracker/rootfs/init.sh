#!/usr/bin/env bash
#
# init.sh — PID 1 inside the Firecracker microVM (spec §2 #2, §5.13 v0.2).
#
# Responsibilities:
#  1. Mount /proc, /sys, /dev/pts, /dev/shm, /run.
#  2. Bring up the loopback interface (Chromium IPC needs 127.0.0.1).
#  3. Place a vsock-broker shim at /run/willbuy/broker.sock so the existing
#     capture-worker broker-client (which dials a Unix socket — see
#     apps/capture-worker/src/broker-client.ts:64) can talk to the host
#     broker via the AF_VSOCK transport with NO worker code changes.
#  4. exec the capture-worker entrypoint as the unprivileged `capture` user.
#
# Why a shim and not a code change in broker-client.ts:
#   Spec §5.13 v0.2: "transport-agnostic by design — the v0.2 migration is
#   a host-side + base-image swap with no schema churn". The wire framing
#   (4-byte big-endian length + JSON) is identical between Unix-socket and
#   vsock; only the dial differs. Issue #116 will replace this shim with
#   a native vsock dial inside broker-client.ts. Until then, this shim
#   keeps issue #114 strictly an artefact-build issue (no apps/ touch).
#
# The shim is intentionally tiny — `socat` ships with the Playwright base
# image and forwards bidirectionally between the Unix socket and the vsock
# CID:port the host broker listens on.
#
# Vsock CID/port convention (locked by issue #115 host bootstrap):
#   Host listens on  VMADDR_CID_HOST (=2), port 5555.
#   Guest dials      VMADDR_CID_HOST,       port 5555.
# The CID / port are read from the kernel cmdline (willbuy.broker_cid=,
# willbuy.broker_port=) so the host can override per-microVM if needed.

set -Eeuo pipefail
IFS=$'\n\t'

readonly BROKER_SOCK="/run/willbuy/broker.sock"
readonly DEFAULT_BROKER_CID="2"
readonly DEFAULT_BROKER_PORT="5555"

log() { printf '[init] %s\n' "$*" > /dev/kmsg 2>/dev/null || printf '[init] %s\n' "$*"; }
die() { log "FATAL: $*"; sleep 1; exit 1; }

mount_pseudofs() {
  log "mounting pseudo-filesystems"
  mount -t proc     proc     /proc
  mount -t sysfs    sysfs    /sys
  mount -t devtmpfs devtmpfs /dev    || true
  mkdir -p /dev/pts /dev/shm /run
  mount -t devpts   devpts   /dev/pts
  mount -t tmpfs    tmpfs    /dev/shm -o nosuid,nodev,size=128m
  mount -t tmpfs    tmpfs    /run     -o nosuid,nodev,size=64m
  mount -t tmpfs    tmpfs    /tmp     -o nosuid,nodev,size=64m
}

bring_up_loopback() {
  log "bringing up lo"
  ip link set lo up
}

read_broker_target() {
  local cmdline cid port
  cmdline="$(cat /proc/cmdline 2>/dev/null || true)"

  cid="${DEFAULT_BROKER_CID}"
  port="${DEFAULT_BROKER_PORT}"

  if [[ "${cmdline}" =~ willbuy\.broker_cid=([0-9]+) ]]; then
    cid="${BASH_REMATCH[1]}"
  fi
  if [[ "${cmdline}" =~ willbuy\.broker_port=([0-9]+) ]]; then
    port="${BASH_REMATCH[1]}"
  fi

  printf '%s %s' "${cid}" "${port}"
}

start_broker_shim() {
  # The shim listens on a Unix socket inside the guest (the path the
  # capture-worker already dials) and forwards each connection to the
  # host's vsock listener at CID:port.
  local cid port
  read -r cid port <<< "$(read_broker_target)"

  log "broker shim: ${BROKER_SOCK} -> vsock:${cid}:${port}"
  mkdir -p "$(dirname -- "${BROKER_SOCK}")"
  chown capture:capture "$(dirname -- "${BROKER_SOCK}")"

  # `socat` is part of the Playwright base image; verify defensively.
  command -v socat &>/dev/null || die "socat not present in rootfs (required for broker shim)"

  socat \
    "UNIX-LISTEN:${BROKER_SOCK},reuseaddr,fork,user=capture,group=capture,mode=0660" \
    "VSOCK-CONNECT:${cid}:${port}" &

  # Give socat a moment to create the socket before the worker dials.
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if [[ -S "${BROKER_SOCK}" ]]; then
      log "broker shim ready (took ${i}*100ms)"
      return 0
    fi
    sleep 0.1
  done
  die "broker shim failed to create ${BROKER_SOCK}"
}

exec_worker() {
  log "exec capture-worker"
  cd /app
  # Drop privileges to UID 1001 (capture). The `capture` user is created in
  # the Dockerfile and matches apps/capture-worker/Dockerfile.
  exec /usr/sbin/runuser -u capture -- /usr/local/bin/bun run apps/capture-worker/src/index.ts
}

main() {
  mount_pseudofs
  bring_up_loopback
  start_broker_shim
  exec_worker
}

main "$@"
