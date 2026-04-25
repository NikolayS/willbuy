#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# scripts/migrate.sh — minimal migration runner for willbuy.
#
# Reads DATABASE_URL from the environment, applies every *.sql file in
# MIGRATIONS_DIR (default: infra/migrations) in lexicographic order that
# is not already recorded in the _migrations tracking table, one
# transaction per file, idempotent on re-apply.
#
# Spec ref: §4.1 (self-hosted Supabase = Postgres). Real schema lands in #26.

readonly DEFAULT_MIGRATIONS_DIR="infra/migrations"

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

ensure_psql() {
  if ! command -v psql >/dev/null 2>&1; then
    # Fall back to docker-bundled psql so a contributor without postgres
    # client tools installed can still apply migrations against any reachable
    # postgres URL.
    if command -v docker >/dev/null 2>&1; then
      # B-NB1: --network host is a no-op shim on Docker Desktop for Mac and
      # cannot reach 127.0.0.1:54322. Replace with host.docker.internal so the
      # caller-supplied DATABASE_URL (which may use 127.0.0.1) is rewritten to
      # the Docker-internal bridge when running on macOS / Docker Desktop.
      # On Linux, host.docker.internal resolves via --add-host; no harm adding it.
      # S-NB2: pin the image by digest so a docker-hub tag re-push cannot
      # silently change the client version used here.
      PSQL_CMD=(docker run --rm -i --add-host=host.docker.internal:host-gateway postgres:16-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50 psql)
      return 0
    fi
    err "psql not found and docker not available; install postgresql-client"
    exit 2
  fi
  PSQL_CMD=(psql)
}

run_psql() {
  # Args: <-c|-f> <value>; reads PSQL_CMD + DATABASE_URL.
  "${PSQL_CMD[@]}" \
    -v ON_ERROR_STOP=1 \
    --quiet \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --dbname="${DATABASE_URL}" \
    "$@"
}

ensure_tracking_table() {
  run_psql -c '
    CREATE TABLE IF NOT EXISTS _migrations (
      filename     TEXT        PRIMARY KEY,
      checksum     TEXT        NOT NULL,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  ' >/dev/null
}

is_applied() {
  local filename="$1"
  local count
  # S-NB1: escape single-quotes in the filename (SQL standard doubling) to
  # avoid SQL injection from a mutated filename. Filenames are developer-
  # controlled today; escaping is categorical defence-in-depth.
  local safe_filename="${filename//\'/\'\'}"
  count="$(run_psql -c "SELECT COUNT(*) FROM _migrations WHERE filename = '${safe_filename}';" | tr -d '[:space:]')"
  [[ "${count}" == "1" ]]
}

checksum_of() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file}" | awk '{print $1}'
  else
    shasum -a 256 "${file}" | awk '{print $1}'
  fi
}

apply_migration() {
  local file="$1"
  local filename
  filename="$(basename "${file}")"
  local checksum
  checksum="$(checksum_of "${file}")"

  err "applying ${filename} (sha256=${checksum:0:12}…)"

  # Atomic-per-file: BEGIN, run the file's statements, INSERT into the
  # tracking table, COMMIT — all in one psql invocation under
  # --single-transaction + ON_ERROR_STOP=1. Any error in any statement
  # aborts the whole transaction (including the tracking INSERT). The
  # SQL is piped over stdin so the docker-bundled psql fallback works
  # the same as a local psql.
  local rc=0
  {
    cat "${file}"
    printf '\n-- migrate.sh: tracking insert\n'
    printf "INSERT INTO _migrations (filename, checksum) VALUES ('%s', '%s');\n" \
      "${filename}" "${checksum}"
  } | "${PSQL_CMD[@]}" \
    -v ON_ERROR_STOP=1 \
    --quiet \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --single-transaction \
    --dbname="${DATABASE_URL}" \
    >/dev/null || rc=$?

  return "${rc}"
}

main() {
  require_env DATABASE_URL
  local migrations_dir="${MIGRATIONS_DIR:-${DEFAULT_MIGRATIONS_DIR}}"
  if [[ ! -d "${migrations_dir}" ]]; then
    err "migrations dir not found: ${migrations_dir}"
    exit 2
  fi

  ensure_psql
  ensure_tracking_table

  local applied=0 skipped=0
  local file filename
  while IFS= read -r -d '' file; do
    filename="$(basename "${file}")"
    if is_applied "${filename}"; then
      # B-NB2: warn on checksum drift so a silently-mutated committed migration
      # file doesn't go unnoticed. The column is forensic-only; no abort.
      local stored_cs on_disk_cs
      local safe_fn="${filename//\'/\'\'}"
      stored_cs="$(run_psql -c "SELECT checksum FROM _migrations WHERE filename = '${safe_fn}';" | tr -d '[:space:]')"
      on_disk_cs="$(checksum_of "${file}")"
      if [[ "${stored_cs}" != "${on_disk_cs}" ]]; then
        err "WARN: checksum drift on ${filename} (stored=${stored_cs:0:12}… on-disk=${on_disk_cs:0:12}…)"
      fi
      skipped=$((skipped + 1))
      continue
    fi
    apply_migration "${file}"
    applied=$((applied + 1))
  done < <(find "${migrations_dir}" -maxdepth 1 -type f -name '*.sql' -print0 | LC_ALL=C sort -z)

  err "done — applied=${applied} skipped=${skipped}"
}

main "$@"
