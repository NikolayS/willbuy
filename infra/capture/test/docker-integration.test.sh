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

# Pull the pause image (small; cached after first run). registry.k8s.io is
# the current canonical mirror; the older gcr.io path was deprecated in 2022.
docker pull registry.k8s.io/pause:3.9 >/dev/null 2>&1 || \
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

# 4a. The pause-container netns has the default-deny ruleset.
#     We read it from the host side via `nsenter` so we don't need a
#     docker image with iptables baked in (alpine ships without it, and
#     `apk add` would itself need network — which is exactly what's
#     blocked here).
pause_pid=$(docker inspect --format '{{.State.Pid}}' "$PAUSE_NAME" 2>/dev/null)
[[ -n "$pause_pid" && "$pause_pid" -gt 0 ]] \
  || fail "could not get pause container PID for ${PAUSE_NAME}"
ipt_policy=$(nsenter -t "$pause_pid" -n iptables -L OUTPUT -n 2>/dev/null \
              | head -1)
[[ "$ipt_policy" == *"DROP"* ]] \
  || fail "pause-container netns does not have default-deny OUTPUT policy (F1: iptables not bound); got: '$ipt_policy'"
pass "pause-container netns has default-deny OUTPUT DROP policy"

# 4b. `docker run --network container:<pause>` accepts the pause name and
#     the resulting capture container is attached to the SAME kernel netns.
#     We verify by reading /proc/self/net/ns from inside the run.
#
#     Pre-pull the image so docker run stdout captures only the readlink
#     output (no "Pulling..." progress lines). The pause image was already
#     pulled above; alpine is the smallest image with readlink available.
docker pull alpine:3.20 >/dev/null 2>&1 || true
container_inode=$(docker run --rm \
  --network "container:${PAUSE_NAME}" \
  --cap-drop ALL \
  alpine:3.20 \
  readlink /proc/self/ns/net 2>/dev/null || true)
host_pause_inode=$(readlink "/proc/${pause_pid}/ns/net" 2>/dev/null || true)
[[ -n "$container_inode" && "$container_inode" == "$host_pause_inode" ]] \
  || fail "capture container netns inode (${container_inode}) != pause netns inode (${host_pause_inode}) — F1 wiring broken"
pass "capture container shares the pause container's network namespace"

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
