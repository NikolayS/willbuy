#!/usr/bin/env bash
# Run on willbuy-v01 by .github/workflows/deploy.yml as root via SSH.
#
# Critical paths:
#   - bun lives at /home/willbuy/.bun/bin/bun (the willbuy user installed it)
#   - /srv/willbuy is owned by willbuy:willbuy; build artifacts must be readable
#     by the willbuy user at runtime
#   - Operations needing root: env file edits, systemctl, docker, nginx, usermod
#   - Operations as willbuy: git pull (so file ownership stays right),
#     bun run next build (so artifacts are owned by willbuy)
#
# Idempotent. Each step uses guards so re-runs are safe.

set -euo pipefail

readonly BUN=/home/willbuy/.bun/bin/bun
readonly REPO=/srv/willbuy

# Run a command as the willbuy user with bun on PATH.
as_willbuy() {
  sudo -u willbuy --preserve-env=PATH \
    env "PATH=/home/willbuy/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    bash -c "$1"
}

cd "$REPO"

echo "::group::pull"
# Git fetch may need credentials that only root has (deploy key). Run as
# root, then chown back so the willbuy user retains ownership of the tree.
git fetch origin main
git reset --hard origin/main
chown -R willbuy:willbuy "$REPO"
echo "::endgroup::"

echo "::group::migrate"
# scripts/migrate.sh shells to bunx → bun. Run as willbuy so PATH includes bun.
DB_URL=$(grep ^DATABASE_URL /etc/willbuy/app.env | cut -d= -f2-)
as_willbuy "cd $REPO && DATABASE_URL='$DB_URL' bash scripts/migrate.sh"
echo "::endgroup::"

echo "::group::env-vars"
# Generate SHARE_TOKEN_HMAC_KEY if missing (PR #496 dependency)
if ! grep -q SHARE_TOKEN_HMAC_KEY /etc/willbuy/app.env; then
  echo "SHARE_TOKEN_HMAC_KEY=$(openssl rand -hex 32)" >> /etc/willbuy/app.env
  echo "Added SHARE_TOKEN_HMAC_KEY"
fi
# Ensure willbuy user is in docker group (PR #490 dependency)
if ! groups willbuy | grep -q docker; then
  usermod -aG docker willbuy
  echo "Added willbuy to docker group"
fi
echo "::endgroup::"

if [[ "${SKIP_BUILD:-false}" != "true" ]]; then
  echo "::group::next-build"
  # Build as willbuy so .next/ artifacts are owned by willbuy (the user that
  # runs willbuy-web.service). Building as root would create root-owned
  # artifacts that the service can't read.
  as_willbuy "cd $REPO/apps/web && $BUN run next build"
  echo "::endgroup::"
else
  echo "Skipping next build (SKIP_BUILD=true)"
fi

echo "::group::install-services"
# Copy service files; only restart daemon if anything actually changed.
changed=0
for svc in willbuy-capture-worker willbuy-visitor-worker willbuy-aggregator-trigger; do
  src="infra/systemd/${svc}.service"
  dst="/etc/systemd/system/${svc}.service"
  if [[ ! -f "$dst" ]] || ! cmp -s "$src" "$dst"; then
    cp "$src" "$dst"
    changed=1
    echo "Updated $dst"
  fi
done
# Aggregator trigger script lives in /usr/local/bin/
if [[ ! -f /usr/local/bin/willbuy-aggregator-trigger.sh ]] || \
   ! cmp -s infra/systemd/willbuy-aggregator-trigger.sh /usr/local/bin/willbuy-aggregator-trigger.sh; then
  cp infra/systemd/willbuy-aggregator-trigger.sh /usr/local/bin/willbuy-aggregator-trigger.sh
  chmod +x /usr/local/bin/willbuy-aggregator-trigger.sh
  changed=1
  echo "Updated willbuy-aggregator-trigger.sh"
fi
if [[ "$changed" == "1" ]]; then
  systemctl daemon-reload
fi
echo "::endgroup::"

echo "::group::aggregator-image"
# Rebuild aggregator image if it doesn't exist OR aggregator sources changed
# since the last build. Use a marker file to track build SHA.
src_sha=$(cd "$REPO" && git rev-parse HEAD:apps/aggregator)
marker=/var/lib/willbuy/aggregator-image.sha
mkdir -p "$(dirname "$marker")"
prev_sha=$(cat "$marker" 2>/dev/null || echo "")
if [[ "$src_sha" != "$prev_sha" ]] || ! docker image inspect willbuy-aggregator >/dev/null 2>&1; then
  # Build context MUST be repo root — Dockerfile uses "COPY apps/aggregator/src" paths
  cd "$REPO"
  docker build -t willbuy-aggregator -f apps/aggregator/Dockerfile .
  echo "$src_sha" > "$marker"
else
  echo "Aggregator sources unchanged; skipping rebuild"
fi
echo "::endgroup::"

echo "::group::restart"
systemctl restart willbuy-api willbuy-web
systemctl enable --now willbuy-capture-worker willbuy-visitor-worker willbuy-aggregator-trigger
echo "::endgroup::"

echo "::group::nginx"
# Sync nginx config from repo to /etc/nginx/sites-available/.
# Without this step, infra/nginx changes (e.g. PR #492's /stripe/ block) are
# never applied even though nginx is "reloaded".
if [[ -f infra/nginx/willbuy.conf ]]; then
  if [[ ! -f /etc/nginx/sites-available/willbuy ]] || \
     ! cmp -s infra/nginx/willbuy.conf /etc/nginx/sites-available/willbuy; then
    cp infra/nginx/willbuy.conf /etc/nginx/sites-available/willbuy
    echo "Updated /etc/nginx/sites-available/willbuy"
  fi
fi
nginx -t && nginx -s reload
echo "::endgroup::"

echo "Deploy complete."
