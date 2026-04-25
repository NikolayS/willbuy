#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# scripts/check-migrations.sh — guard against migration-number collisions.
#
# Issue #100. Three collisions in one day (PR #89+#91 on 0014, PR #95+#96 on
# 0016, plus a near-miss on PR #82) each cost a ~30-min hotfix or in-PR
# renumber. Run this in CI before tests so duplicates fail fast.
#
# Checks:
#   1. No duplicate 4-digit prefixes in infra/migrations/.
#   2. No duplicate 4-digit prefixes in infra/sqlever/deploy/.
#   3. Every infra/migrations/00NN_*.sql has a matching deploy script.
#   4. Every infra/sqlever/deploy/00NN_*.sql has a sqitch.plan entry.
#
# Run path is the cwd, so tests can point it at a fixture tree.

migrations_dir="infra/migrations"
sqlever_dir="infra/sqlever/deploy"
plan_file="infra/sqlever/sqitch.plan"

# Check 1: no duplicate prefixes in infra/migrations/.
dups=$(ls "${migrations_dir}" | grep -oE '^[0-9]{4}' | sort | uniq -d || true)
if [[ -n "${dups}" ]]; then
  echo "ERROR: duplicate migration number prefix(es) in ${migrations_dir}: ${dups}" >&2
  # Show the offending files so the engineer doesn't have to grep manually.
  pattern=$(echo "${dups}" | tr '\n' '|' | sed 's/|$//')
  ls "${migrations_dir}" | grep -E "^(${pattern})_" >&2 || true
  exit 1
fi

# Check 2: no duplicate prefixes in infra/sqlever/deploy/.
dups=$(ls "${sqlever_dir}" | grep -oE '^[0-9]{4}' | sort | uniq -d || true)
if [[ -n "${dups}" ]]; then
  echo "ERROR: duplicate migration number prefix(es) in ${sqlever_dir}: ${dups}" >&2
  pattern=$(echo "${dups}" | tr '\n' '|' | sed 's/|$//')
  ls "${sqlever_dir}" | grep -E "^(${pattern})_" >&2 || true
  exit 1
fi

# Check 3: every infra/migrations/00NN_*.sql has a matching deploy script.
# Filter to .sql files so non-SQL artefacts (e.g. README.md) don't trip the guard.
missing_in_deploy=$(comm -23 \
  <(ls "${migrations_dir}" | grep '\.sql$' | sort) \
  <(ls "${sqlever_dir}" | grep '\.sql$' | sort) || true)
if [[ -n "${missing_in_deploy}" ]]; then
  echo "ERROR: migrations present in ${migrations_dir} but missing in ${sqlever_dir}:" >&2
  echo "${missing_in_deploy}" >&2
  exit 1
fi

# Check 4: every sqlever/deploy/00NN_*.sql has a sqitch.plan entry.
for f in "${sqlever_dir}"/[0-9]*.sql; do
  name=$(basename "${f}" .sql)
  if ! grep -qE "^${name}\\b" "${plan_file}"; then
    echo "ERROR: ${name} has no entry in ${plan_file}" >&2
    exit 1
  fi
done

count=$(ls "${migrations_dir}" | grep -E '^[0-9].*\.sql$' | wc -l | tr -d ' ')
echo "migration-collision check: OK (${count} migrations, all unique, all paired, all in plan)"
