#!/usr/bin/env bash
#
# host-budget-enforcer.sh — spec §2 #5 / §2 #6 (≤ 50 distinct egress hosts).
#
# Counts the number of distinct destination IPs the capture container has
# opened a connection to, by reading the netns conntrack table. If the count
# exceeds the budget, prints a structured `breach_reason=host_count` line on
# stdout and exits non-zero so the worker aborts the container.
#
# This is a defense-in-depth check on top of the iptables ACCEPT allow-list:
# the iptables list itself is sized to ≤ 50 entries at bring-up, but a target
# whose own page returns 60 distinct subresource hosts would still try to
# resolve them in-container; the resolved IPs that aren't already in the
# allow-list are DROP'd by the default-deny policy, but we want a clean,
# observable abort signal — not "page just hangs".
#
# Usage:
#   host-budget-enforcer.sh <netns-name> [budget]
#
# Output (always to stdout, single line, parseable):
#   host_count=<n>            (under budget)
#   host_count=<n> breach_reason=host_count   (over budget; exit 1)

set -Eeuo pipefail
IFS=$'\n\t'

readonly PROG="host-budget-enforcer.sh"
readonly DEFAULT_BUDGET=50

log() {
  printf '%s %s\n' "$PROG" "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 2
}

count_hosts() {
  # `conntrack -L` lists every flow tracked in the netns. We count distinct
  # destination IPs (not flows) because a single subresource may open multiple
  # parallel connections to the same host. We INCLUDE both v4 and v6 entries.
  #
  # `--src-nat` and reply tuples are filtered out — we only want the "original
  # direction destination" address.
  local netns="$1"
  ip netns exec "$netns" conntrack -L 2>/dev/null \
    | awk '
        {
          for (i = 1; i <= NF; i++) {
            if ($i ~ /^dst=/) {
              # The first dst= field per line is the original direction.
              print substr($i, 5)
              next
            }
          }
        }
      ' \
    | sort -u \
    | wc -l \
    | tr -d ' '
}

main() {
  if [[ $# -lt 1 || $# -gt 2 ]]; then
    die "usage: $PROG <netns-name> [budget]"
  fi
  local netns="$1"
  local budget="${2:-$DEFAULT_BUDGET}"

  [[ "$netns" =~ ^[a-zA-Z0-9_-]+$ ]] || die "invalid netns name: $netns"
  [[ "$budget" =~ ^[0-9]+$ ]] || die "budget must be a non-negative integer: $budget"

  if ! ip netns list 2>/dev/null | awk '{print $1}' | grep -qx "$netns"; then
    die "netns does not exist: $netns"
  fi

  local count
  count=$(count_hosts "$netns")

  if (( count > budget )); then
    printf 'host_count=%s breach_reason=host_count\n' "$count"
    exit 1
  fi
  printf 'host_count=%s\n' "$count"
}

main "$@"
