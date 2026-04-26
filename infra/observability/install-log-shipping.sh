#!/usr/bin/env bash
# infra/observability/install-log-shipping.sh
#
# Idempotent installer for willbuy.dev local log shipping (issue #118 / spec
# §5.12). Installs the logrotate config, ensures /var/log/willbuy/ exists with
# the right ownership and mode, then validates the config with
# `logrotate -d` (dry-run debug mode) so the operator sees exactly what would
# happen on the next rotation cycle.
#
# Usage:
#   sudo ./infra/observability/install-log-shipping.sh
#
# What this script does (idempotent — safe to re-run):
#   1. Creates /var/log/willbuy/ (mode 0750, owned by willbuy:willbuy) if it
#      does not already exist. If it exists, leaves it alone — operator may
#      have customised ownership.
#   2. Copies infra/observability/logrotate.conf → /etc/logrotate.d/willbuy
#      (mode 0644, root-owned per logrotate's read-only requirement).
#   3. Validates the installed config with `logrotate -d /etc/logrotate.d/willbuy`
#      (dry-run debug). Fails the script on any logrotate error.
#   4. Prints a success line summarising the install.
#
# Prereqs: logrotate package installed (Ubuntu/Debian: `apt-get install logrotate`).
# Run as root (or via sudo) — needs to write to /etc/logrotate.d/.

set -euo pipefail

# ---------------------------------------------------------------------------
# Tunables — overridable via environment for tests / staging.
# ---------------------------------------------------------------------------
LOG_DIR="${WILLBUY_LOG_DIR:-/var/log/willbuy}"
LOG_USER="${WILLBUY_LOG_USER:-willbuy}"
LOG_GROUP="${WILLBUY_LOG_GROUP:-willbuy}"
LOG_DIR_MODE="${WILLBUY_LOG_DIR_MODE:-0750}"
LOGROTATE_DEST="${WILLBUY_LOGROTATE_DEST:-/etc/logrotate.d/willbuy}"
LOGROTATE_OWNER="${WILLBUY_LOGROTATE_OWNER:-root}"
LOGROTATE_GROUP="${WILLBUY_LOGROTATE_GROUP:-root}"

# Resolve the source config relative to this script so the installer works
# whether invoked from the repo root or from the script's own directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGROTATE_SRC="${WILLBUY_LOGROTATE_SRC:-${SCRIPT_DIR}/logrotate.conf}"

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------
if [[ ! -f "${LOGROTATE_SRC}" ]]; then
    echo "error: source config not found at ${LOGROTATE_SRC}" >&2
    exit 1
fi

if ! command -v logrotate >/dev/null 2>&1; then
    echo "error: logrotate not installed (apt-get install logrotate)" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 1. Ensure /var/log/willbuy/ exists
# ---------------------------------------------------------------------------
if [[ ! -d "${LOG_DIR}" ]]; then
    echo "==> creating ${LOG_DIR} (mode ${LOG_DIR_MODE}, owner ${LOG_USER}:${LOG_GROUP})"
    install -d -m "${LOG_DIR_MODE}" -o "${LOG_USER}" -g "${LOG_GROUP}" "${LOG_DIR}"
else
    echo "==> ${LOG_DIR} already exists; leaving ownership/mode alone"
fi

# ---------------------------------------------------------------------------
# 2. Install the logrotate config
# ---------------------------------------------------------------------------
echo "==> installing ${LOGROTATE_SRC} → ${LOGROTATE_DEST}"
mkdir -p "$(dirname "${LOGROTATE_DEST}")"
install -m 0644 -o "${LOGROTATE_OWNER}" -g "${LOGROTATE_GROUP}" "${LOGROTATE_SRC}" "${LOGROTATE_DEST}"

# ---------------------------------------------------------------------------
# 3. Validate with logrotate -d (dry-run debug)
# ---------------------------------------------------------------------------
echo "==> validating with: logrotate -d ${LOGROTATE_DEST}"
logrotate -d "${LOGROTATE_DEST}"

# ---------------------------------------------------------------------------
# 4. Done
# ---------------------------------------------------------------------------
echo
echo "OK: log-shipping installed."
echo "    log dir       : ${LOG_DIR}"
echo "    rotate config : ${LOGROTATE_DEST}"
echo "    retention     : 14 days (per spec §5.12)"
echo "    next rotation : on the next /etc/cron.daily/logrotate run"
