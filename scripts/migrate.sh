#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# scripts/migrate.sh — thin sqlever wrapper for willbuy schema migrations.
#
# Amendment A4 (2026-04-24): replaces the bash migration runner from PR #46
# with NikolayS/sqlever — the postgres-ai canonical migration tool.
#
# Usage:
#   DATABASE_URL=postgres://... bash scripts/migrate.sh
#
# The sqlever project lives in infra/sqlever/ (sqitch.conf + sqitch.plan +
# deploy/ scripts). sqlever tracks applied changes in sqitch.* schema tables.
# Each deploy script also writes a backward-compat row into _migrations so
# that existing tools and test assertions reading _migrations work unchanged.
#
# SQLEVER_TOP_DIR: override the project directory (used by tests to point at
# a temp project with extra/bad changes). Defaults to infra/sqlever/.
#
# Spec refs: §5.6 (migration runner), §15 (CI), amendment A4.

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly DEFAULT_SQLEVER_DIR="${REPO_ROOT}/infra/sqlever"

err() {
  printf '%s\n' "migrate: $*" >&2
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    err "${name} is required"
    exit 2
  fi
}

main() {
  require_env DATABASE_URL

  local sqlever_dir="${SQLEVER_TOP_DIR:-${DEFAULT_SQLEVER_DIR}}"

  if [[ ! -d "${sqlever_dir}" ]]; then
    err "sqlever project dir not found: ${sqlever_dir}"
    exit 2
  fi

  # bunx resolves sqlever from the workspace's node_modules (installed as a
  # devDependency). Falls back to npx if bunx is not available so CI runners
  # that have not installed Bun can still run this script with Node.
  local sqlever_runner
  if command -v bunx >/dev/null 2>&1; then
    sqlever_runner="bunx"
  elif command -v npx >/dev/null 2>&1; then
    sqlever_runner="npx"
  else
    err "neither bunx nor npx found; install Bun (>=1.1) or Node with npm"
    exit 2
  fi

  err "running sqlever deploy (top-dir=${sqlever_dir})…"

  # --no-tui: disable the interactive dashboard in non-TTY environments
  # (CI, test containers). --db-uri: explicit URI so sqitch.conf default
  # target is never used in multi-target setups.
  "${sqlever_runner}" sqlever deploy \
    --top-dir "${sqlever_dir}" \
    --db-uri  "${DATABASE_URL}" \
    --no-tui

  err "done"
}

main "$@"
