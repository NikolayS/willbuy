#!/usr/bin/env bash
#
# privileged.test.sh — end-to-end netns + iptables acceptance (spec §5.13).
#
# Runs ONLY on the `egress-integration` CI job (Linux, root or NET_ADMIN).
# Locally:
#   sudo WILLBUY_PRIVILEGED=1 infra/capture/test/privileged.test.sh
#
# Five acceptance scenarios from issue #33:
#  1. Container in netns → DROP on 169.254.169.254, 127.0.0.1, RFC1918,
#     ::1, fe80::, fc00::, 2001:db8::.
#  2. Container in netns → ACCEPT on the resolved target IP.
#  3. Container in netns → DROP on an IPv6 cloud-metadata alias.
#  4. Cross-eTLD+1 redirect → re-check rejects (DNS pinning prevents
#     on-demand resolve of the new host).
#  5. Host-budget enforcer → 60 distinct destination IPs in conntrack
#     reports `breach_reason=host_count` and exits non-zero at 50.
#
# Hermetic strategy: instead of hitting the public internet, we set up TWO
# sibling network namespaces — `wb-target` (the "outside world") and
# `wb-capture` (the capture container). A veth pair connects them. The
# capture netns gets the iptables ruleset; the target netns runs a tiny HTTP
# fixture on a public-shaped IP. The capture's allow-list contains JUST that
# fixture IP, so allowed traffic flows and disallowed traffic (lo / RFC1918
# / etc.) is DROP'd by the same iptables rules our production bring-up
# would emit.

set -Eeuo pipefail
IFS=$'\n\t'

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
INFRA_DIR="$(cd "$HERE/.." && pwd)"
readonly INFRA_DIR

# Public-shaped, RFC5737 documentation prefix — never routes on the public
# internet, so the test is isolated even on a host without veth segregation.
readonly TARGET_HOST_IP="203.0.113.10"
readonly CAPTURE_HOST_IP="203.0.113.11"
readonly TARGET_NS="wb-target-test"
readonly CAPTURE_NS="wb-capture-test"
readonly VETH_TARGET="veth-tgt-tst"
readonly VETH_CAPTURE="veth-cap-tst"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  cleanup || true
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

cleanup() {
  ip netns pids "$TARGET_NS"  2>/dev/null | xargs -r kill 2>/dev/null || true
  ip netns pids "$CAPTURE_NS" 2>/dev/null | xargs -r kill 2>/dev/null || true
  ip netns delete "$TARGET_NS"  2>/dev/null || true
  ip netns delete "$CAPTURE_NS" 2>/dev/null || true
  ip link delete  "$VETH_TARGET" 2>/dev/null || true
  rm -rf "${state_dir:-}" 2>/dev/null || true
}

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    fail "must run as root (privileged tests). Try: sudo WILLBUY_PRIVILEGED=1 $0"
  fi
}

[[ "${WILLBUY_PRIVILEGED:-0}" == "1" ]] \
  || { printf 'SKIP: WILLBUY_PRIVILEGED!=1 (re-run with sudo WILLBUY_PRIVILEGED=1)\n'; exit 0; }

require_root
for c in ip iptables ip6tables nc python3 conntrack; do require_cmd "$c"; done

trap 'cleanup' EXIT

state_dir="$(mktemp -d)"

cleanup  # idempotent: clear anything from a prior failed run.

# 1. Build the test topology.
ip netns add "$TARGET_NS"
ip netns add "$CAPTURE_NS"

ip link add "$VETH_TARGET" type veth peer name "$VETH_CAPTURE"
ip link set  "$VETH_TARGET"  netns "$TARGET_NS"
ip link set  "$VETH_CAPTURE" netns "$CAPTURE_NS"

ip -n "$TARGET_NS"  addr add "${TARGET_HOST_IP}/24"  dev "$VETH_TARGET"
ip -n "$CAPTURE_NS" addr add "${CAPTURE_HOST_IP}/24" dev "$VETH_CAPTURE"
ip -n "$TARGET_NS"  link set "$VETH_TARGET"  up
ip -n "$CAPTURE_NS" link set "$VETH_CAPTURE" up
ip -n "$TARGET_NS"  link set lo up
ip -n "$CAPTURE_NS" link set lo up

# A /24 on the veth gives the capture netns ON-LINK reachability for the
# entire 203.0.113.0/24 RFC5737 doc range — that's how scenarios 4 + 5
# (connect-and-be-DROPped to 198.51.100.42 / 203.0.113.{1..60}) actually
# emit packets that hit the iptables OUTPUT chain. With a /30 the kernel
# would route everything except the peer through a missing default route
# and EHOSTUNREACH would short-circuit iptables.
#
# We add an explicit on-link route for 198.51.100.0/24 (the cross-eTLD+1
# redirect target's pretend home) and a default route for everything else
# so DROP rules for RFC1918 / link-local / etc. actually fire.
ip -n "$CAPTURE_NS" route add 198.51.100.0/24 dev "$VETH_CAPTURE"
ip -n "$CAPTURE_NS" route add default dev "$VETH_CAPTURE"

# 2. Start a tiny HTTP fixture in the target netns.
ip netns exec "$TARGET_NS" python3 -m http.server 80 --bind "$TARGET_HOST_IP" \
  >/tmp/wb-fixture.log 2>&1 &
http_pid=$!
# Wait for the listening socket to actually be up. Python's http.server takes
# 100–500 ms to bind in a fresh netns.
for _ in $(seq 1 20); do
  if ip netns exec "$TARGET_NS" ss -ltn 2>/dev/null \
       | awk -v ip="$TARGET_HOST_IP" '$4 == ip":80" {found=1} END {exit !found}'; then
    break
  fi
  sleep 0.2
done
if ! ip netns exec "$TARGET_NS" ss -ltn 2>/dev/null \
     | awk -v ip="$TARGET_HOST_IP" '$4 == ip":80" {found=1} END {exit !found}'; then
  ip netns exec "$TARGET_NS" ss -ltn || true
  cat /tmp/wb-fixture.log >&2 || true
  fail "fixture HTTP server failed to bind ${TARGET_HOST_IP}:80"
fi
[[ -d /proc/$http_pid ]] || fail "fixture HTTP server died after start"

# 3. Program the capture netns with the production rule shape (default-deny
#    + DROP for every CIDR in egress-deny.txt + ACCEPT only for TARGET_HOST_IP
#    on tcp/80). We CALL THE REAL FUNCTION via a sub-bash so the bring-up
#    script's own `readonly HERE/PROG` declarations don't collide with this
#    test's own readonly state.
bash -c "
  set -Eeuo pipefail
  IFS=\$'\n\t'
  helper_src=\$(sed '\$ d' '$INFRA_DIR/netns-bringup.sh')
  eval \"\$helper_src\"
  apply_rules '$CAPTURE_NS' '$TARGET_HOST_IP' '' '$INFRA_DIR/egress-deny.txt'
"

pass "topology + iptables programmed"

# — Acceptance scenario 1: internal-IP DROP ——————————————————————
#
# Two-part assertion strategy:
#  (a) `iptables -S OUTPUT` MUST contain a `-A OUTPUT -d <cidr> -j DROP`
#      line for every CIDR in egress-deny.txt — this proves the rules were
#      programmed at bring-up, regardless of whether the kernel chose to
#      route a probe packet through the chain (link-local addresses, in
#      particular, can be route-rejected before iptables).
#  (b) attempting a TCP connection to a deny-list address MUST fail
#      (timeout or unreachable) — this proves no packet escapes the netns.
#
# Counter-based assertions are intentionally avoided because the kernel may
# REJECT the route lookup for link-local destinations BEFORE iptables runs,
# and we don't want a sound rule to be reported as "missing" because of
# routing-layer behavior outside iptables' purview.

assert_rule_present() {
  local family="$1" cidr="$2"
  local table="iptables"
  [[ "$family" == "v6" ]] && table="ip6tables"
  ip netns exec "$CAPTURE_NS" "$table" -S OUTPUT \
    | grep -qF -- "-A OUTPUT -d ${cidr} -j DROP" \
    || fail "missing DROP rule in $table OUTPUT for $cidr"
}

assert_unreachable() {
  local proto="$1" addr="$2" label="$3"
  local nc_args="-w 1"
  [[ "$proto" == "v6" ]] && nc_args="-6 -w 1"
  if ip netns exec "$CAPTURE_NS" timeout 1 \
       bash -c "nc $nc_args '$addr' 80 </dev/null >/dev/null 2>&1"; then
    fail "$label: connection unexpectedly succeeded ($addr)"
  fi
}

# 1a. cloud metadata
assert_rule_present v4 169.254.0.0/16
assert_unreachable  v4 169.254.169.254 "scenario 1a (cloud metadata)"
pass "scenario 1a: 169.254.169.254 DROP'd"

# 1b. loopback
assert_rule_present v4 127.0.0.0/8
assert_unreachable  v4 127.0.0.1 "scenario 1b (loopback)"
pass "scenario 1b: 127.0.0.1 unreachable from netns"

# 1c. RFC1918
assert_rule_present v4 10.0.0.0/8
assert_unreachable  v4 10.0.0.5 "scenario 1c (RFC1918)"
pass "scenario 1c: 10.0.0.0/8 DROP'd"

# 1d. IPv6 internal ranges
assert_rule_present v6 ::1/128
assert_rule_present v6 fc00::/7
assert_rule_present v6 fe80::/10
assert_unreachable  v6 fd00::1 "scenario 1d (ULA)"
pass "scenario 1d: IPv6 internal ranges DROP'd"

# — Acceptance scenario 2: allowed target IP ACCEPT ——————————————

ip netns exec "$CAPTURE_NS" iptables -Z OUTPUT
got=$(ip netns exec "$CAPTURE_NS" timeout 3 \
        python3 -c "
import socket, sys
s = socket.socket(); s.settimeout(2)
s.connect(('${TARGET_HOST_IP}', 80))
s.sendall(b'GET / HTTP/1.0\r\nHost: ${TARGET_HOST_IP}\r\n\r\n')
data = s.recv(64)
sys.stdout.write('OK' if data.startswith(b'HTTP/') else 'BAD')
" 2>/dev/null || printf 'TIMEOUT')
if [[ "$got" != "OK" ]]; then
  printf '%s\n' "scenario 2 diagnostic dump:" >&2
  ip netns exec "$CAPTURE_NS" iptables -L OUTPUT -v -n -x >&2 || true
  ip netns exec "$CAPTURE_NS" iptables -L INPUT -v -n -x >&2 || true
  ip netns exec "$CAPTURE_NS" ip route >&2 || true
  ip netns exec "$TARGET_NS"  ss -ltn >&2 || true
  fail "scenario 2: allowed target unreachable (got '$got')"
fi
pass "scenario 2: 203.0.113.10:80 (target) reachable"

# — Acceptance scenario 3: IPv6 cloud-metadata alias ————————————

# fd00:ec2::254/128 is in the deny file as a discrete entry AND fc00::/7 is
# a superset; either DROP rule covers the alias.
ip netns exec "$CAPTURE_NS" ip6tables -S OUTPUT \
  | grep -qE -- '-A OUTPUT -d (fd00:ec2::254/128|fc00::/7) -j DROP' \
  || fail "no DROP rule covering fd00:ec2::254"
assert_unreachable v6 fd00:ec2::254 "scenario 3 (v6 cloud-metadata alias)"
pass "scenario 3: IPv6 cloud-metadata alias DROP'd"

# — Acceptance scenario 4: cross-eTLD+1 redirect re-check ————————

# Build a state file as if bring-up had pinned only TARGET_HOST_IP, then
# attempt a connection to a DIFFERENT public IP. The DROP must fire because
# only TARGET_HOST_IP is in the allow-list.
ip netns exec "$CAPTURE_NS" iptables -Z OUTPUT
ip netns exec "$CAPTURE_NS" timeout 1 nc -w 1 198.51.100.42 80 </dev/null >/dev/null 2>&1 || true
# 198.51.100.0/24 is RFC5737 docs but is NOT in our deny list, so it won't
# match a DROP CIDR — it must be DROP'd by the DEFAULT POLICY (-P OUTPUT DROP).
# We assert outcome (connection refused) rather than reading per-rule counters,
# because the default-policy counter is at the table level and not directly
# addressable by `iptables -L`.
if ip netns exec "$CAPTURE_NS" timeout 1 \
     python3 -c "import socket; s=socket.socket(); s.settimeout(1); s.connect(('198.51.100.42', 80))" \
     >/dev/null 2>&1; then
  fail "cross-eTLD+1 redirect target was reachable!"
fi
pass "scenario 4: redirect target (not pre-resolved) is unreachable (DNS pinning enforced at netns)"

# — Acceptance scenario 5: host-budget enforcer ———————————————

# Synthesize 60 distinct destination flows in the target netns by attempting
# a connection to 60 distinct IPs. Each attempt creates a conntrack entry
# even if the SYN is DROP'd, because conntrack hooks fire BEFORE iptables.
# Fan out in parallel to keep the suite under the CI job timeout budget.
for i in $(seq 1 60); do
  ip netns exec "$CAPTURE_NS" timeout 1 nc -w 1 "203.0.113.${i}" 80 \
    </dev/null >/dev/null 2>&1 &
done
wait || true

set +e
out=$("$INFRA_DIR/host-budget-enforcer.sh" "$CAPTURE_NS" 50)
rc=$?
set -e
echo "host-budget enforcer output: $out (exit $rc)"
[[ "$rc" -eq 1 ]] || fail "expected exit 1 from host-budget enforcer, got $rc"
echo "$out" | grep -q 'breach_reason=host_count' \
  || fail "expected breach_reason=host_count in output: $out"
count=$(echo "$out" | sed -n 's/.*host_count=\([0-9]*\).*/\1/p')
[[ "$count" -gt 50 ]] || fail "expected host_count > 50, got $count"
pass "scenario 5: host-budget enforcer aborts at >50 distinct hosts (count=$count)"

printf '\nALL PRIVILEGED TESTS PASSED\n'
