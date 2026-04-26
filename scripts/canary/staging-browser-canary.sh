#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# scripts/canary/staging-browser-canary.sh — weekly browser-stack patch
# SLO canary (issue #124, spec §2 #4 + §5.16).
#
# Runs a single Playwright capture against the known-good local fixture
# (or any fixture endpoint exposed by the staging environment), feeds
# the result through compareCanaryToBaseline (apps/capture-worker/src/
# canary.ts), and exits 0 on green / 1 on regression / 2 on harness
# error. Idempotent — invoking it twice in a row produces the same
# verdict (the only state it touches is stdout).
#
# Local run:
#   WILLBUY_CANARY_BASE_URL=http://127.0.0.1:3014 \
#     ./scripts/canary/staging-browser-canary.sh
#
# Dry run (skip the actual browser launch — useful in CI smoke tests
# and for verifying the script itself parses):
#   ./scripts/canary/staging-browser-canary.sh --dry-run
#
# Env vars:
#   WILLBUY_CANARY_BASE_URL    base URL hosting the fixture (required)
#   WILLBUY_CANARY_FIXTURE_PATH  fixture path (default /r/test-fixture)
#   WILLBUY_CANARY_TIMEOUT_S   bash-side hard timeout (default 120s)
#
# Exit codes:
#   0  canary green; promote allowed
#   1  canary red; rollback per docs/runbooks/browser-patch-slo.md §Rollback
#   2  harness error (network, missing deps, misconfig); not a verdict

dry_run="false"
for arg in "$@"; do
  case "${arg}" in
    --dry-run) dry_run="true" ;;
    -h|--help)
      sed -n '7,32p' "${BASH_SOURCE[0]}" | sed 's/^# //;s/^#$//'
      exit 0
      ;;
    *)
      echo "unknown argument: ${arg}" >&2
      exit 2
      ;;
  esac
done

base_url="${WILLBUY_CANARY_BASE_URL:-}"
fixture_path="${WILLBUY_CANARY_FIXTURE_PATH:-/r/test-fixture}"
timeout_s="${WILLBUY_CANARY_TIMEOUT_S:-120}"

if [[ "${dry_run}" == "true" ]]; then
  cat <<EOF
{"ok":true,"reason":null,"target":"${base_url:-<unset>}${fixture_path}","dry_run":true}
EOF
  exit 0
fi

if [[ -z "${base_url}" ]]; then
  echo "WILLBUY_CANARY_BASE_URL is required (set to the staging fixture origin, e.g. http://127.0.0.1:3014)" >&2
  exit 2
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found on PATH — install via https://bun.sh" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runner="${here}/run-canary.ts"

if [[ ! -f "${runner}" ]]; then
  echo "runner not found: ${runner}" >&2
  exit 2
fi

# `timeout` isn't on macOS by default; fall back to a backgrounded kill
# pattern when absent, since the canary owner (Nik) sometimes runs this
# locally on a Mac before pushing to staging.
run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${timeout_s}" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${timeout_s}" "$@"
  else
    "$@" &
    local pid=$!
    ( sleep "${timeout_s}" && kill -TERM "${pid}" 2>/dev/null || true ) &
    local watcher=$!
    wait "${pid}"
    local rc=$?
    kill -TERM "${watcher}" 2>/dev/null || true
    return "${rc}"
  fi
}

WILLBUY_CANARY_BASE_URL="${base_url}" \
WILLBUY_CANARY_FIXTURE_PATH="${fixture_path}" \
  run_with_timeout bun "${runner}"
