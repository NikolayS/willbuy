#!/usr/bin/env bash
#
# netns-teardown.sh — companion to netns-bringup.sh.
#
# Removes the network namespace and its state file. Idempotent: re-running
# against an already-torn-down netns is a no-op (exit 0). The capture worker
# calls this in a `trap` after `docker run`, regardless of capture outcome.
#
# Usage:
#   netns-teardown.sh <netns-name>
#
# Environment:
#   WILLBUY_STATE_DIR   optional; default '/run/willbuy/netns'.

set -Eeuo pipefail
IFS=$'\n\t'

readonly PROG="netns-teardown.sh"
readonly DEFAULT_STATE_DIR="/run/willbuy/netns"

log() {
  printf '%s %s\n' "$PROG" "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

main() {
  if [[ $# -ne 1 ]]; then
    die "usage: $PROG <netns-name>"
  fi
  local netns="$1"
  local state_dir="${WILLBUY_STATE_DIR:-${DEFAULT_STATE_DIR}}"

  [[ "$netns" =~ ^[a-zA-Z0-9_-]+$ ]] || die "invalid netns name: $netns"

  # Stop the pause container (its removal also destroys the kernel netns the
  # capture container was attached to). The --rm flag on docker run means
  # `docker stop` removes it automatically; `docker rm -f` is idempotent
  # and handles the case where --rm lost the race on an abrupt kill.
  local pause_name="pause-${netns}"
  if docker inspect --format '{{.State.Status}}' "$pause_name" 2>/dev/null | grep -qv '^$'; then
    log "stopping pause container: $pause_name"
    docker rm -f "$pause_name" 2>/dev/null || true
  else
    log "pause container absent, nothing to stop: $pause_name"
  fi

  # Legacy: remove any iproute2 named netns left by a prior code version.
  if ip netns list 2>/dev/null | awk '{print $1}' | grep -qx "$netns"; then
    log "deleting legacy iproute2 netns: $netns"
    ip netns delete "$netns"
  fi

  local state_file="${state_dir}/${netns}.state"
  if [[ -f "$state_file" ]]; then
    rm -f "$state_file"
    log "removed state file: $state_file"
  fi
}

main "$@"
