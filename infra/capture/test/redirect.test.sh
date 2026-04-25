#!/usr/bin/env bash
#
# redirect.test.sh — exercises the cross-eTLD+1 redirect re-check (spec §2 #5).
#
# This test does NOT need NET_ADMIN. It runs in two phases:
#   1. Drive netns-bringup.sh with WILLBUY_DRY_RUN=1 to materialize a state
#      file with a known allowed-IP set.
#   2. Hand-roll a redirect-check parser using the same state file format
#      that run-with-netns.ts reads, and assert:
#        a. redirect to a host that resolves to one of the allowed IPs → ok,
#        b. redirect to a host that resolves to ANY other IP → reject,
#        c. redirect to a host that resolves to an internal IP → reject.

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

state_dir="$(mktemp -d)"
shim_dir="$(mktemp -d)"
trap 'rm -rf "$state_dir" "$shim_dir"' EXIT

cat > "$shim_dir/getent" <<'EOF'
#!/usr/bin/env bash
# Initial target a.com → 203.0.113.10 (public).
case "$2" in
  a.com)        printf '203.0.113.10  STREAM a.com\n' ;;
  same.example) printf '203.0.113.10  STREAM same.example\n' ;;
  b.com)        printf '198.51.100.42 STREAM b.com\n' ;;       # different public IP
  bad.example)  printf '169.254.169.254 STREAM bad.example\n' ;; # internal!
  *)            exit 2 ;;
esac
EOF
chmod +x "$shim_dir/getent"

PATH="$shim_dir:$PATH" \
WILLBUY_DRY_RUN=1 \
WILLBUY_STATE_DIR="$state_dir" \
"$INFRA_DIR/netns-bringup.sh" redir_ns http://a.com/ >/dev/null

state_file="$state_dir/redir_ns.state"
[[ -f "$state_file" ]] || fail "state file missing: $state_file"

# Pure-shell redirect-check identical in shape to run-with-netns.ts:
#   read allowed_ipv4= line, split on ',', resolve <host>, all addrs MUST be
#   in the allowed set.
check_redirect() {
  local host="$1"
  local allowed
  allowed=$(grep '^allowed_ipv4=' "$state_file" | cut -d= -f2-)
  local resolved
  resolved=$(PATH="$shim_dir:$PATH" getent ahosts "$host" 2>/dev/null \
              | awk '{print $1}' | sort -u)
  [[ -n "$resolved" ]] || { printf 'REJECT dns_fail\n'; return 1; }
  local ip ok=1
  while IFS= read -r ip; do
    [[ -z "$ip" ]] && continue
    if [[ ",$allowed," != *",$ip,"* ]]; then
      ok=0
      break
    fi
  done <<< "$resolved"
  if (( ok )); then
    printf 'ALLOW\n'
    return 0
  fi
  printf 'REJECT cross_etld_redirect\n'
  return 1
}

# 1. Same-target redirect → allow.
check_redirect same.example >/dev/null || fail "same.example should be allowed"
pass "redirect to same allowed IP: allow"

# 2. Different public IP → reject (the cross-eTLD+1 case).
out="$(check_redirect b.com 2>&1 || true)"
[[ "$out" == "REJECT cross_etld_redirect" ]] \
  || fail "expected REJECT cross_etld_redirect; got '$out'"
pass "redirect to different public IP: reject (cross-eTLD+1)"

# 3. Redirect to a hostname resolving to an internal IP → reject.
out="$(check_redirect bad.example 2>&1 || true)"
[[ "$out" == "REJECT cross_etld_redirect" ]] \
  || fail "expected REJECT for internal-IP redirect; got '$out'"
pass "redirect to internal IP: reject"

printf '\nALL REDIRECT TESTS PASSED\n'
