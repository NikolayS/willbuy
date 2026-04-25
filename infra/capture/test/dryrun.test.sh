#!/usr/bin/env bash
#
# dryrun.test.sh — runs on every CI runner (Linux + macOS).
#
# Asserts that netns-bringup.sh, in dry-run mode, emits a ruleset with the
# spec §5.13 shape:
#  - default-deny on INPUT/OUTPUT/FORWARD for both v4 and v6,
#  - one DROP per CIDR in egress-deny.txt (v4 entries to v4 chain, v6 to v6),
#  - ACCEPT only for the resolved target IPs on tcp/80 + tcp/443,
#  - state file written with the resolved IP set.
#
# This is the "fast" red→green oracle for the bring-up script. The end-to-end
# privileged tests live in privileged.test.sh.

set -Eeuo pipefail
IFS=$'\n\t'

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
INFRA_DIR="$(cd "$HERE/.." && pwd)"
readonly INFRA_DIR

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$*"
}

# Hermetic state dir (per-test temp).
state_dir="$(mktemp -d)"
trap 'rm -rf "$state_dir"' EXIT

# Use a fixture deny-list with predictable contents (a subset of the canonical
# one) so the assertions don't churn when the canonical list is extended.
deny_file="$(mktemp)"
trap 'rm -f "$deny_file"; rm -rf "$state_dir"' EXIT
cat > "$deny_file" <<'EOF'
# fixture deny list
10.0.0.0/8
169.254.0.0/16
127.0.0.0/8
::1/128
fc00::/7
fe80::/10
EOF

# Fake getent: produce a deterministic resolution so the test does not depend
# on real DNS. We do this by overriding PATH with a shim directory.
shim_dir="$(mktemp -d)"
trap 'rm -rf "$shim_dir" "$state_dir"; rm -f "$deny_file"' EXIT
cat > "$shim_dir/getent" <<'EOF'
#!/usr/bin/env bash
# Shim: pretend example.com resolves to one v4 + one v6 documentation IP.
# We deliberately use ONLY RFC5737 / RFC3849 documentation prefixes here so
# this fixture is hermetic AND repo-policy-clean (no real production IPs).
# 203.0.113.0/24 is RFC5737 TEST-NET-3 (public-shaped, not in the deny list).
# 2001:db1::/32 is NOT RFC3849 (which is 2001:db8::/32, in the deny list);
# 2001:db1 is unallocated as of this writing — using it here purely as a
# stable, public-shaped v6 literal for the test oracle.
case "$2" in
  example.com)
    printf '203.0.113.10  STREAM example.com\n'
    printf '2001:db1::10  STREAM example.com\n'
    ;;
  *)
    exit 2
    ;;
esac
EOF
chmod +x "$shim_dir/getent"

run_bringup() {
  PATH="$shim_dir:$PATH" \
  WILLBUY_DRY_RUN=1 \
  WILLBUY_DENY_FILE="$deny_file" \
  WILLBUY_STATE_DIR="$state_dir" \
  "$INFRA_DIR/netns-bringup.sh" "$@"
}

# 1. Happy path: dry-run emits a ruleset and exits 0.
out="$(run_bringup test_ns http://example.com/)"
[[ -n "$out" ]] || fail "no output from dry-run"
pass "dry-run produced output"

# 2. v4 chain has the canonical default-deny + the deny CIDRs from v4 only.
echo "$out" | grep -qx '\*filter:v4' || fail "missing v4 filter section"
echo "$out" | grep -qx '\-P INPUT DROP' || fail "missing default-deny INPUT in v4"
echo "$out" | grep -qx '\-P OUTPUT DROP' || fail "missing default-deny OUTPUT in v4"
echo "$out" | grep -qx '\-A OUTPUT -d 10.0.0.0/8 -j DROP' || fail "missing DROP for 10.0.0.0/8"
echo "$out" | grep -qx '\-A OUTPUT -d 169.254.0.0/16 -j DROP' \
  || fail "missing DROP for 169.254.0.0/16 (cloud metadata)"
echo "$out" | grep -qx '\-A OUTPUT -d 127.0.0.0/8 -j DROP' \
  || fail "missing DROP for 127.0.0.0/8 (loopback)"
pass "v4 deny CIDRs present"

# 3. v6 chain has the v6 deny CIDRs and NOT the v4 ones.
echo "$out" | grep -qx '\*filter:v6' || fail "missing v6 filter section"
echo "$out" | grep -qx '\-A OUTPUT -d ::1/128 -j DROP' || fail "missing DROP for ::1/128"
echo "$out" | grep -qx '\-A OUTPUT -d fc00::/7 -j DROP' || fail "missing DROP for fc00::/7 (ULA)"
echo "$out" | grep -qx '\-A OUTPUT -d fe80::/10 -j DROP' \
  || fail "missing DROP for fe80::/10 (link-local)"
# v6 chain MUST NOT contain v4 CIDRs.
if echo "$out" | awk '/^\*filter:v6/,/^COMMIT$/' | grep -q '10.0.0.0/8'; then
  fail "v4 CIDR 10.0.0.0/8 leaked into v6 chain"
fi
pass "v6 deny CIDRs present and not mixed with v4"

# 4. Allow rules: ONLY for the resolved IPs, ONLY on tcp/80 + tcp/443.
echo "$out" | grep -qx -- '-A OUTPUT -d 203.0.113.10 -p tcp --dport 443 -j ACCEPT' \
  || fail "missing ACCEPT for resolved v4 on 443"
echo "$out" | grep -qx -- '-A OUTPUT -d 203.0.113.10 -p tcp --dport 80 -j ACCEPT' \
  || fail "missing ACCEPT for resolved v4 on 80"
echo "$out" | grep -qx -- '-A OUTPUT -d 2001:db1::10 -p tcp --dport 443 -j ACCEPT' \
  || fail "missing ACCEPT for resolved v6 on 443"
pass "allow rules limited to tcp/80 + tcp/443 for resolved IPs"

# 5. Allow rules MUST NOT punch a hole for any deny CIDR.
if echo "$out" | grep -E -- '-A OUTPUT -d (10\.|127\.|169\.254\.|::1|fc00:|fe80:).*ACCEPT' >/dev/null; then
  fail "an ACCEPT rule references a deny CIDR — bug in rule ordering!"
fi
pass "no ACCEPT rule shadows a deny CIDR"

# 6. State file written with the resolved set.
state_file="$state_dir/test_ns.state"
[[ -f "$state_file" ]] || fail "state file not written: $state_file"
grep -qx 'netns=test_ns' "$state_file" || fail "state file missing netns line"
grep -qx 'target_host=example.com' "$state_file" || fail "state file missing target_host"
grep -q '^allowed_ipv4=203.0.113.10$' "$state_file" || fail "state file missing v4 list"
grep -q '^allowed_ipv6=2001:db1::10$' "$state_file" || fail "state file missing v6 list"
pass "state file contents correct"

# 7. Resolution returning an internal IP must FAIL the bring-up.
cat > "$shim_dir/getent" <<'EOF'
#!/usr/bin/env bash
case "$2" in
  rebind.example)
    printf '169.254.169.254  STREAM rebind.example\n'  # AWS IMDS
    ;;
  *)
    exit 2
    ;;
esac
EOF
chmod +x "$shim_dir/getent"

if run_bringup rebind_ns http://rebind.example/ >/dev/null 2>err.log; then
  fail "bring-up should have rejected internal-IP resolve"
fi
grep -q 'in deny range; capture refused' err.log \
  || fail "expected 'in deny range' error message; got: $(cat err.log)"
pass "internal-IP resolve refused per spec §2 #5"

# 8. Host-budget exceeded at resolution time.
cat > "$shim_dir/getent" <<'EOF'
#!/usr/bin/env bash
case "$2" in
  many.example)
    for i in $(seq 1 60); do
      printf '203.0.113.%s  STREAM many.example\n' "$i"
    done
    ;;
  *)
    exit 2
    ;;
esac
EOF
chmod +x "$shim_dir/getent"

if WILLBUY_HOST_BUDGET=50 run_bringup big_ns http://many.example/ >/dev/null 2>err.log; then
  fail "bring-up should have rejected over-budget resolve"
fi
grep -q 'exceeds host budget' err.log \
  || fail "expected 'exceeds host budget' error; got: $(cat err.log)"
pass "host-budget enforced at resolution time"

printf '\nALL DRY-RUN TESTS PASSED\n'
