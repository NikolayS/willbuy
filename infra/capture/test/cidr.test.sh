#!/usr/bin/env bash
#
# cidr.test.sh — pure-shell CIDR-membership unit tests.
#
# Sources netns-bringup.sh in a sub-shell (without invoking main) so we can
# call its internal `cidr_match`, `v4_in_cidr`, `v6_in_cidr`, and
# `is_private_ip` functions directly.

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

# Source the bring-up script with a hijacked `main` so we get the helpers
# without running the full pipeline. We override BASH_SOURCE-driven main
# invocation by setting a sentinel: the script's `main "$@"` line at the
# bottom unconditionally runs, so we can't just `source`. Instead, we run a
# sub-bash that defines the functions and then runs our test cases.

run_in_helpers() {
  bash -c "
    set -Eeuo pipefail
    IFS=\$'\n\t'
    # Strip the trailing 'main \"\$@\"' line so sourcing doesn't run main.
    helpers_src=\$(sed '\$ d' '$INFRA_DIR/netns-bringup.sh')
    eval \"\$helpers_src\"
    $1
  "
}

# v4 — exact match
run_in_helpers 'v4_in_cidr 10.0.0.5 10.0.0.0 8 || exit 1' \
  || fail "10.0.0.5 should be in 10.0.0.0/8"
pass "v4: 10.0.0.5 ∈ 10.0.0.0/8"

# v4 — boundary outside
run_in_helpers 'v4_in_cidr 11.0.0.0 10.0.0.0 8 && exit 1' || true
run_in_helpers 'v4_in_cidr 11.0.0.0 10.0.0.0 8' && fail "11.0.0.0 must NOT be in 10.0.0.0/8"
pass "v4: 11.0.0.0 ∉ 10.0.0.0/8"

# v4 — /32 host route
run_in_helpers 'v4_in_cidr 169.254.169.254 169.254.169.254 32' \
  || fail "AWS IMDS /32 self-match"
pass "v4: 169.254.169.254/32 self-match"

# v4 — /0 catches everything
run_in_helpers 'v4_in_cidr 8.8.8.8 0.0.0.0 0' \
  || fail "/0 should match any v4"
pass "v4: 0.0.0.0/0 matches anything"

# v6 — loopback
run_in_helpers 'v6_in_cidr ::1 ::1 128' || fail "::1/128 self-match"
pass "v6: ::1/128 self-match"

# v6 — ULA
run_in_helpers 'v6_in_cidr fd12:3456:789a::1 fc00:: 7' \
  || fail "fd12:: should be in fc00::/7"
pass "v6: fd12::1 ∈ fc00::/7"

# v6 — link-local
run_in_helpers 'v6_in_cidr fe80::abcd fe80:: 10' \
  || fail "fe80::abcd should be in fe80::/10"
pass "v6: fe80::abcd ∈ fe80::/10"

# v6 — public outside ULA
if run_in_helpers 'v6_in_cidr 2001:db1::1 fc00:: 7'; then
  fail "2001:db1::1 must NOT be in fc00::/7"
fi
pass "v6: 2001:db1::1 ∉ fc00::/7"

# v6 — documentation prefix
run_in_helpers 'v6_in_cidr 2001:db8:dead::beef 2001:db8:: 32' \
  || fail "2001:db8:dead::beef should be in 2001:db8::/32"
pass "v6: 2001:db8:dead::beef ∈ 2001:db8::/32"

# v6 — cloud-metadata alias (AWS IMDSv6)
run_in_helpers 'v6_in_cidr fd00:ec2::254 fd00:ec2::254 128' \
  || fail "fd00:ec2::254 self-match"
pass "v6: fd00:ec2::254/128 self-match"

# is_private_ip against the canonical deny list.
deny_file="$INFRA_DIR/egress-deny.txt"
[[ -r "$deny_file" ]] || fail "deny file missing: $deny_file"

for ip in 10.0.0.5 192.168.1.1 172.20.5.5 100.64.0.1 127.0.0.1 \
           169.254.169.254 ::1 fe80::1 fd00::1 fd00:ec2::254 \
           2001:db8::abcd; do
  run_in_helpers "is_private_ip $ip $deny_file" \
    || fail "is_private_ip should match $ip"
done
pass "all spec §2 #5 internal IPs match the canonical deny list"

# Public IPs must NOT match.
for ip in 8.8.8.8 1.1.1.1 203.0.113.10 2001:db1::1 2606:4700::1; do
  if run_in_helpers "is_private_ip $ip $deny_file"; then
    fail "is_private_ip should NOT match public IP $ip"
  fi
done
pass "public IPs do not match the canonical deny list"

# v4_to_int input validation (F5 — defense-in-depth at trust boundary).
# Malformed octet (> 255) must cause v4_to_int to die() rather than silently
# computing a nonsense integer that bypasses the deny-list check.
if run_in_helpers 'v4_to_int 999.0.0.1 2>/dev/null'; then
  fail "v4_to_int must reject octet > 255 (got exit 0)"
fi
pass "v4_to_int rejects octet > 255 (F5)"

# Non-numeric garbage must also be rejected.
if run_in_helpers 'v4_to_int garbage 2>/dev/null'; then
  fail "v4_to_int must reject non-IP input (got exit 0)"
fi
pass "v4_to_int rejects non-numeric input (F5)"

# Fewer than 4 octets must be rejected.
if run_in_helpers 'v4_to_int 10.0.1 2>/dev/null'; then
  fail "v4_to_int must reject < 4 octets (got exit 0)"
fi
pass "v4_to_int rejects fewer than 4 octets (F5)"

printf '\nALL CIDR TESTS PASSED\n'
