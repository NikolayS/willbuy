#!/usr/bin/env bash
# Run on willbuy-v01 by .github/workflows/deploy.yml.
#
# Idempotent. Each step uses guards so re-runs are safe.

set -euo pipefail

cd /srv/willbuy

echo "::group::pull"
git fetch origin main
git reset --hard origin/main
echo "::endgroup::"

echo "::group::migrate"
DATABASE_URL=$(grep ^DATABASE_URL /etc/willbuy/app.env | cut -d= -f2-) \
  bash scripts/migrate.sh
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
  cd apps/web && bun run next build
  cd /srv/willbuy
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
# Rebuild aggregator image only if its sources changed
if [[ -n "$(git diff HEAD@{1} HEAD -- apps/aggregator 2>/dev/null)" ]] || ! docker image inspect willbuy-aggregator >/dev/null 2>&1; then
  cd apps/aggregator
  docker build -t willbuy-aggregator .
  cd /srv/willbuy
else
  echo "Aggregator sources unchanged; skipping rebuild"
fi
echo "::endgroup::"

echo "::group::restart"
systemctl restart willbuy-api willbuy-web
systemctl enable --now willbuy-capture-worker willbuy-visitor-worker willbuy-aggregator-trigger
echo "::endgroup::"

echo "::group::nginx"
nginx -t && nginx -s reload
echo "::endgroup::"

echo "Deploy complete."
