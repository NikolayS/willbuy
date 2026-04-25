#!/usr/bin/env bash
#
# netns-bringup.sh — spec §5.13 (v0.1 container transport) + §2 #5.
#
# Given a target URL, this script:
#   1. Resolves the target hostname ONCE via the host resolver (per-request
#      DNS pinning — spec §2 #5).
#   2. Creates a Linux network namespace with a veth pair to the host.
#   3. Programs iptables (v4) + ip6tables (v6) in the namespace with:
#        - default-deny INPUT/OUTPUT/FORWARD,
#        - allow ESTABLISHED/RELATED inbound,
#        - allow ONLY the resolved target IPs outbound to 80/443,
#        - explicit DROP for every CIDR in egress-deny.txt (defense-in-depth
#          ordered BEFORE the allow rules so a crafted payload that resolves
#          target.example to an internal IP cannot bypass the deny set).
#   4. Hard-caps the allow set at 50 distinct host IPs (§2 #6 / §2 #5).
#      Resolution rejects on any private/metadata IP — capture fails per spec.
#   5. Writes a state file the worker uses to add subresource IPs after a
#      cross-eTLD+1 redirect re-check, and to count distinct hosts for the
#      host-budget enforcer.
#
# Usage:
#   netns-bringup.sh <netns-name> <target-url>
#
# Environment:
#   WILLBUY_RESOLVER         optional; nameserver IP for getent/dig fallback.
#                            Default: host's /etc/resolv.conf.
#   WILLBUY_STATE_DIR        optional; default '/run/willbuy/netns'.
#   WILLBUY_DENY_FILE        optional; default '<this dir>/egress-deny.txt'.
#   WILLBUY_HOST_BUDGET      optional; default 50.
#   WILLBUY_DRY_RUN          optional; '1' prints the iptables ruleset
#                            without applying it. Used by integration tests
#                            on hosts without NET_ADMIN.
#
# Requires: ip(8), iptables(8), ip6tables(8), getent(1) — capability NET_ADMIN.
# This script is invoked by run-with-netns.ts BEFORE the docker container is
# unpaused, so a Chromium escape inside the container has no path to host
# services. See spec §5.13.
#
# Public-repo discipline: NO real IPs in this file. The veth prefix is RFC1918
# and the deny ranges all come from spec §2 #5.

set -Eeuo pipefail
IFS=$'\n\t'

readonly PROG="netns-bringup.sh"
readonly DEFAULT_STATE_DIR="/run/willbuy/netns"
readonly DEFAULT_HOST_BUDGET=50
# BASH_SOURCE may be unset when this script is sourced via `eval`/heredoc in
# tests; guard the lookup so `set -u` doesn't trip on the test harness path.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || printf '.')"
readonly HERE

log() {
  printf '%s %s\n' "$PROG" "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

is_private_ip() {
  # Returns 0 (true) when the supplied IP literal falls inside any deny CIDR.
  # We re-implement subnet membership in pure bash to avoid a `ipcalc`
  # runtime dep. v4 and v6 are handled separately.
  local ip="$1"
  local deny_file="$2"
  local cidr family
  family="v4"
  [[ "$ip" == *:* ]] && family="v6"

  while IFS= read -r line; do
    cidr="${line%%#*}"
    cidr="${cidr//[[:space:]]/}"
    [[ -z "$cidr" ]] && continue
    if [[ "$cidr" == *:* ]]; then
      [[ "$family" == "v6" ]] || continue
    else
      [[ "$family" == "v4" ]] || continue
    fi
    if cidr_match "$ip" "$cidr"; then
      return 0
    fi
  done < "$deny_file"
  return 1
}

cidr_match() {
  # cidr_match <ip> <cidr> — pure-bash CIDR membership.
  # v4: 32-bit arithmetic. v6: bitwise on 8 16-bit groups.
  local ip="$1" cidr="$2"
  local net bits
  net="${cidr%/*}"
  bits="${cidr#*/}"
  if [[ "$ip" == *:* ]]; then
    v6_in_cidr "$ip" "$net" "$bits"
  else
    v4_in_cidr "$ip" "$net" "$bits"
  fi
}

v4_to_int() {
  local ip="$1"
  local IFS=.
  # shellcheck disable=SC2206
  local parts=($ip)
  printf '%s' $(( (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3] ))
}

v4_in_cidr() {
  local ip="$1" net="$2" bits="$3"
  local ip_int net_int mask
  ip_int=$(v4_to_int "$ip")
  net_int=$(v4_to_int "$net")
  if (( bits == 0 )); then
    mask=0
  else
    mask=$(( 0xFFFFFFFF << (32 - bits) & 0xFFFFFFFF ))
  fi
  (( (ip_int & mask) == (net_int & mask) ))
}

v6_expand() {
  # Expand `::` and short groups into 8 4-hex groups (lowercase, no separators
  # between groups — caller splits on space). Pure bash; no python dep.
  local ip="$1"
  local left right
  if [[ "$ip" == *::* ]]; then
    left="${ip%%::*}"
    right="${ip##*::}"
  else
    left="$ip"
    right=""
  fi
  local -a lparts=() rparts=() all=()
  if [[ -n "$left" ]]; then
    IFS=':' read -r -a lparts <<< "$left"
  fi
  if [[ -n "$right" ]]; then
    IFS=':' read -r -a rparts <<< "$right"
  fi
  local lcount=${#lparts[@]}
  local rcount=${#rparts[@]}
  local missing=$(( 8 - lcount - rcount ))
  local p
  if (( lcount > 0 )); then
    for p in "${lparts[@]}"; do all+=("$p"); done
  fi
  while (( missing-- > 0 )); do all+=("0"); done
  if (( rcount > 0 )); then
    for p in "${rparts[@]}"; do all+=("$p"); done
  fi
  local out="" g
  for g in "${all[@]}"; do
    out+=" $(printf '%04x' $((16#${g:-0})))"
  done
  printf '%s' "${out# }"
}

v6_in_cidr() {
  local ip="$1" net="$2" bits="$3"
  local ip_exp net_exp
  ip_exp=$(v6_expand "$ip")
  net_exp=$(v6_expand "$net")
  # Word-split on spaces explicitly — top-level IFS=$'\n\t' suppresses
  # the default behavior on $(...) expansion in array context.
  local -a ipg netg
  local OLDIFS="$IFS"
  IFS=' '
  # shellcheck disable=SC2206
  ipg=($ip_exp)
  # shellcheck disable=SC2206
  netg=($net_exp)
  IFS="$OLDIFS"
  local remaining=$bits i mask group_mask
  for (( i=0; i<8; i++ )); do
    if (( remaining >= 16 )); then
      group_mask=0xFFFF
      remaining=$(( remaining - 16 ))
    elif (( remaining > 0 )); then
      group_mask=$(( 0xFFFF << (16 - remaining) & 0xFFFF ))
      remaining=0
    else
      group_mask=0
    fi
    mask=$group_mask
    if (( (16#${ipg[i]} & mask) != (16#${netg[i]} & mask) )); then
      return 1
    fi
  done
  return 0
}

resolve_host() {
  # Resolve <host> via getent. Returns one IP per line (v4 + v6).
  # This is the ONE-SHOT resolution required by spec §2 #5; the resulting
  # set is what iptables allows. Subsequent in-container DNS lookups that
  # return a different IP (rebind) will be DROP'd at the netns boundary.
  local host="$1"
  getent ahosts "$host" | awk '{print $1}' | sort -u
}

emit_rules() {
  # Render the iptables/ip6tables ruleset for <netns> + <ipv4 list> + <ipv6 list>
  # into stdout. Used both for the real apply and for the dry-run test.
  local netns="$1"
  local v4_list="$2"
  local v6_list="$3"
  local deny_file="$4"

  printf '# netns=%s\n' "$netns"
  printf '*filter:v4\n'
  printf -- '-P INPUT DROP\n'
  printf -- '-P OUTPUT DROP\n'
  printf -- '-P FORWARD DROP\n'
  printf -- '-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT\n'
  printf -- '-A INPUT -i lo -j ACCEPT\n'
  printf -- '-A OUTPUT -o lo -j ACCEPT\n'
  while IFS= read -r line; do
    local cidr="${line%%#*}"
    cidr="${cidr//[[:space:]]/}"
    [[ -z "$cidr" || "$cidr" == *:* ]] && continue
    printf -- '-A OUTPUT -d %s -j DROP\n' "$cidr"
  done < "$deny_file"
  while IFS= read -r ip; do
    [[ -z "$ip" ]] && continue
    printf -- '-A OUTPUT -d %s -p tcp --dport 443 -j ACCEPT\n' "$ip"
    printf -- '-A OUTPUT -d %s -p tcp --dport 80 -j ACCEPT\n' "$ip"
  done <<< "$v4_list"
  printf 'COMMIT\n'

  printf '*filter:v6\n'
  printf -- '-P INPUT DROP\n'
  printf -- '-P OUTPUT DROP\n'
  printf -- '-P FORWARD DROP\n'
  printf -- '-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT\n'
  printf -- '-A INPUT -i lo -j ACCEPT\n'
  printf -- '-A OUTPUT -o lo -j ACCEPT\n'
  while IFS= read -r line; do
    local cidr="${line%%#*}"
    cidr="${cidr//[[:space:]]/}"
    [[ -z "$cidr" || "$cidr" != *:* ]] && continue
    printf -- '-A OUTPUT -d %s -j DROP\n' "$cidr"
  done < "$deny_file"
  while IFS= read -r ip; do
    [[ -z "$ip" ]] && continue
    printf -- '-A OUTPUT -d %s -p tcp --dport 443 -j ACCEPT\n' "$ip"
    printf -- '-A OUTPUT -d %s -p tcp --dport 80 -j ACCEPT\n' "$ip"
  done <<< "$v6_list"
  printf 'COMMIT\n'
}

apply_rules() {
  # Apply the rendered ruleset inside the netns. Each `iptables -A` runs
  # `ip netns exec <netns> iptables ...`. We program v4 + v6 in one go.
  local netns="$1"
  local v4_list="$2"
  local v6_list="$3"
  local deny_file="$4"

  ip netns exec "$netns" iptables -P INPUT DROP
  ip netns exec "$netns" iptables -P OUTPUT DROP
  ip netns exec "$netns" iptables -P FORWARD DROP
  ip netns exec "$netns" iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip netns exec "$netns" iptables -A INPUT -i lo -j ACCEPT
  ip netns exec "$netns" iptables -A OUTPUT -o lo -j ACCEPT

  ip netns exec "$netns" ip6tables -P INPUT DROP
  ip netns exec "$netns" ip6tables -P OUTPUT DROP
  ip netns exec "$netns" ip6tables -P FORWARD DROP
  ip netns exec "$netns" ip6tables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip netns exec "$netns" ip6tables -A INPUT -i lo -j ACCEPT
  ip netns exec "$netns" ip6tables -A OUTPUT -o lo -j ACCEPT

  local cidr
  while IFS= read -r line; do
    cidr="${line%%#*}"
    cidr="${cidr//[[:space:]]/}"
    [[ -z "$cidr" ]] && continue
    if [[ "$cidr" == *:* ]]; then
      ip netns exec "$netns" ip6tables -A OUTPUT -d "$cidr" -j DROP
    else
      ip netns exec "$netns" iptables -A OUTPUT -d "$cidr" -j DROP
    fi
  done < "$deny_file"

  local ip4 ip6
  while IFS= read -r ip4; do
    [[ -z "$ip4" ]] && continue
    ip netns exec "$netns" iptables -A OUTPUT -d "$ip4" -p tcp --dport 443 -j ACCEPT
    ip netns exec "$netns" iptables -A OUTPUT -d "$ip4" -p tcp --dport 80 -j ACCEPT
  done <<< "$v4_list"
  while IFS= read -r ip6; do
    [[ -z "$ip6" ]] && continue
    ip netns exec "$netns" ip6tables -A OUTPUT -d "$ip6" -p tcp --dport 443 -j ACCEPT
    ip netns exec "$netns" ip6tables -A OUTPUT -d "$ip6" -p tcp --dport 80 -j ACCEPT
  done <<< "$v6_list"
}

write_state() {
  local netns="$1"
  local target_host="$2"
  local v4_list="$3"
  local v6_list="$4"
  local state_dir="$5"
  install -d -m 0755 "$state_dir"
  local state_file="${state_dir}/${netns}.state"
  {
    printf 'netns=%s\n' "$netns"
    printf 'target_host=%s\n' "$target_host"
    printf 'created_at=%s\n' "$(date -u +%FT%TZ)"
    printf 'allowed_ipv4=%s\n' "$(tr '\n' ',' <<< "$v4_list" | sed 's/,$//')"
    printf 'allowed_ipv6=%s\n' "$(tr '\n' ',' <<< "$v6_list" | sed 's/,$//')"
  } > "$state_file"
  chmod 0644 "$state_file"
  printf '%s' "$state_file"
}

main() {
  if [[ $# -ne 2 ]]; then
    die "usage: $PROG <netns-name> <target-url>"
  fi
  local netns="$1"
  local url="$2"
  local deny_file="${WILLBUY_DENY_FILE:-${HERE}/egress-deny.txt}"
  local state_dir="${WILLBUY_STATE_DIR:-${DEFAULT_STATE_DIR}}"
  local host_budget="${WILLBUY_HOST_BUDGET:-${DEFAULT_HOST_BUDGET}}"
  local dry_run="${WILLBUY_DRY_RUN:-0}"

  [[ -r "$deny_file" ]] || die "deny file not readable: $deny_file"
  [[ "$netns" =~ ^[a-zA-Z0-9_-]+$ ]] || die "invalid netns name (must match [a-zA-Z0-9_-]+): $netns"

  # Extract host from URL. We require a scheme + host; query/fragment are ignored.
  local host
  host="$(extract_host "$url")"
  [[ -n "$host" ]] || die "could not extract host from URL: $url"

  log "resolving target host: $host"
  local resolved
  resolved=$(resolve_host "$host" || true)
  [[ -n "$resolved" ]] || die "DNS resolution failed for $host"

  # Split into v4 / v6 and enforce: every resolved IP must be PUBLIC.
  # If any IP lands in a deny CIDR -> fail capture (spec §2 #5: "capture fails
  # if any resolved IP lands in a private/metadata range even post-resolution").
  local v4_list="" v6_list="" ip
  local count=0
  while IFS= read -r ip; do
    [[ -z "$ip" ]] && continue
    if is_private_ip "$ip" "$deny_file"; then
      die "resolved IP $ip is in deny range; capture refused"
    fi
    count=$(( count + 1 ))
    if (( count > host_budget )); then
      die "resolved IP set exceeds host budget ($host_budget)"
    fi
    if [[ "$ip" == *:* ]]; then
      v6_list+="${ip}"$'\n'
    else
      v4_list+="${ip}"$'\n'
    fi
  done <<< "$resolved"

  v4_list="${v4_list%$'\n'}"
  v6_list="${v6_list%$'\n'}"

  if [[ "$dry_run" == "1" ]]; then
    log "DRY RUN — emitting ruleset, NOT applying"
    emit_rules "$netns" "$v4_list" "$v6_list" "$deny_file"
    write_state "$netns" "$host" "$v4_list" "$v6_list" "$state_dir" >/dev/null
    return 0
  fi

  log "creating netns: $netns"
  if ip netns list | awk '{print $1}' | grep -qx "$netns"; then
    die "netns $netns already exists; tear down first"
  fi
  ip netns add "$netns"
  ip netns exec "$netns" ip link set lo up

  log "programming iptables in $netns"
  apply_rules "$netns" "$v4_list" "$v6_list" "$deny_file"

  local state_file
  state_file=$(write_state "$netns" "$host" "$v4_list" "$v6_list" "$state_dir")
  log "ready: state=$state_file ipv4=$(wc -l <<< "$v4_list" | tr -d ' ') ipv6=$(wc -l <<< "$v6_list" | tr -d ' ')"
}

extract_host() {
  # Pure-bash URL host extractor. Accepts http(s)://host[:port]/...
  local url="$1"
  local rest
  rest="${url#*://}"
  rest="${rest%%/*}"
  rest="${rest%%\?*}"
  rest="${rest%%#*}"
  rest="${rest%%:*}"  # strip :port
  printf '%s' "$rest"
}

main "$@"
