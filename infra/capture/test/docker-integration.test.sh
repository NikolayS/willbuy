#!/usr/bin/env bash
#
# docker-integration.test.sh — end-to-end pause-container + docker-run test.
#
# Verifies the F1 fix: netns-bringup.sh starts a real Docker pause container,
# programs iptables into its kernel netns via nsenter, and `docker run
# --network container:<pause>` succeeds and sees the programmed rules.
#
# Runs as root (sudo) in the `egress-integration` CI job on ubuntu-latest.
# Docker is available on the default GitHub Actions ubuntu runner.
#
# Local reproduction:
#   sudo bash infra/capture/test/docker-integration.test.sh

set -Eeuo pipefail
IFS=$'\n\t'

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
INFRA_DIR="$(cd "$HERE/.." && pwd)"
readonly INFRA_DIR

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  cleanup || true
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$*"
}

readonly TEST_NETNS="wb-di-test"
readonly PAUSE_NAME="pause-${TEST_NETNS}"

cleanup() {
  docker rm -f "$PAUSE_NAME" 2>/dev/null || true
  rm -rf "${state_dir:-}" 2>/dev/null || true
}

trap 'cleanup' EXIT

state_dir="$(mktemp -d)"
cleanup  # idempotent: clear any prior run.

# Shim getent to avoid external DNS in CI.
shim_dir="$(mktemp -d)"
trap 'rm -rf "$shim_dir" "$state_dir"' EXIT
cat > "$shim_dir/getent" <<'EOF'
#!/usr/bin/env bash
case "$2" in
  di.example) printf '203.0.113.10  STREAM di.example\n' ;;
  *)          exit 2 ;;
esac
EOF
chmod +x "$shim_dir/getent"

# Ensure Docker is available.
docker info >/dev/null 2>&1 || fail "Docker not available"

# Pull the pause image (small; cached after first run).
docker pull gcr.io/pause:3.9 >/dev/null 2>&1 || \
  docker pull k8s.gcr.io/pause:3.9 >/dev/null 2>&1 || \
  fail "could not pull pause image"

# 1. Run bringup (non-dry-run) — this starts the pause container.
PATH="$shim_dir:$PATH" \
WILLBUY_DENY_FILE="$INFRA_DIR/egress-deny.txt" \
WILLBUY_STATE_DIR="$state_dir" \
"$INFRA_DIR/netns-bringup.sh" "$TEST_NETNS" "http://di.example/" \
  >/dev/null 2>&1 || fail "netns-bringup.sh failed"

pass "bringup completed"

# 2. State file must record pause_container= field (F1 contract).
grep -q "^pause_container=${PAUSE_NAME}$" "$state_dir/${TEST_NETNS}.state" \
  || fail "state file missing pause_container=${PAUSE_NAME} (F1 contract)"
pass "state file records pause_container"

# 3. Pause container must be running.
status=$(docker inspect --format '{{.State.Status}}' "$PAUSE_NAME" 2>/dev/null || true)
[[ "$status" == "running" ]] \
  || fail "pause container ${PAUSE_NAME} not running (status='$status')"
pass "pause container is running"

# 4. docker run --network container:<pause> works (the key F1 assertion:
#    Docker's --network container:NAME accepts a real container name).
#    We run alpine to check iptables rules are present in the container's
#    netns. The container must see the OUTPUT chain with default-deny policy.
ipt_policy=$(docker run --rm \
  --network "container:${PAUSE_NAME}" \
  --cap-add NET_ADMIN \
  alpine:3.20 \
  sh -c "iptables -L OUTPUT -n | head -1" 2>/dev/null || true)
[[ "$ipt_policy" == *"DROP"* ]] \
  || fail "capture container does not see default-deny OUTPUT policy (F1: iptables not bound before container start); got: '$ipt_policy'"
pass "capture container sees default-deny OUTPUT DROP policy in pause container netns"

# 5. Run teardown — pause container must be removed.
WILLBUY_STATE_DIR="$state_dir" \
"$INFRA_DIR/netns-teardown.sh" "$TEST_NETNS" >/dev/null 2>&1 \
  || fail "netns-teardown.sh failed"
sleep 0.5
remaining=$(docker inspect --format '{{.State.Status}}' "$PAUSE_NAME" 2>/dev/null || true)
[[ -z "$remaining" ]] \
  || fail "pause container ${PAUSE_NAME} still exists after teardown (status='$remaining')"
pass "teardown removed pause container"

printf '\nALL DOCKER INTEGRATION TESTS PASSED\n'
