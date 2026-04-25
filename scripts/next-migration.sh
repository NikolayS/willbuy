#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# scripts/next-migration.sh — generate the next migration pair.
#
# Issue #100. Removes the manual step of looking at the highest existing
# prefix and bumping by one — that's the step where parallel PRs collide.
# This script picks the next free prefix and creates both the migrations/
# and sqlever/deploy/ stub at once.
#
# Usage:
#   bash scripts/next-migration.sh <slug>
#
# Don't forget to add the new entry to infra/sqlever/sqitch.plan.

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <slug>" >&2
  exit 1
fi

slug="$1"
migrations_dir="infra/migrations"
sqlever_dir="infra/sqlever/deploy"

last=$(ls "${migrations_dir}" | grep -oE '^[0-9]{4}' | sort -n | tail -1)
next=$(printf "%04d" $((10#${last} + 1)))
name="${next}_${slug}"

touch "${migrations_dir}/${name}.sql"
touch "${sqlever_dir}/${name}.sql"

echo "${name} created in both dirs. Don't forget to add to infra/sqlever/sqitch.plan."
