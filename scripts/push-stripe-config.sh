#!/usr/bin/env bash
# Push Stripe configuration to /etc/willbuy/app.env on willbuy-v01.
#
# Mirrors the push-secrets.sh pattern but targets the application env file
# (where DATABASE_URL, SESSION_HMAC_KEY, and the STRIPE_* vars live).
#
# Why a separate file from secrets.env: app.env is read by the API at
# startup (it's the EnvironmentFile= for willbuy-api.service); secrets.env
# is sourced by other scripts on the host. Keeping them separate matches
# the existing topology.
#
# Two modes:
#
#   1. Env-var mode (preferred — pairs with `op run` for 1Password):
#        op run --env-file=.env.op -- bash scripts/push-stripe-config.sh
#      Requires these env vars (rendered by op from your 1Password vault):
#        STRIPE_SECRET_KEY
#        STRIPE_WEBHOOK_SECRET
#        STRIPE_PRICE_ID_STARTER
#        STRIPE_PRICE_ID_GROWTH
#        STRIPE_PRICE_ID_SCALE
#
#   2. Interactive mode (for first-time setup before vault items exist):
#        bash scripts/push-stripe-config.sh --interactive
#      Prompts for each value, pushes once. Values not stored locally.
#
# After running, the API picks them up on next restart:
#        gh workflow run deploy.yml --repo NikolayS/willbuy
#   OR   ssh -p 2223 root@willbuy-v01 'systemctl restart willbuy-api'
#
# Usage:
#   bash scripts/push-stripe-config.sh                     # env-var mode
#   bash scripts/push-stripe-config.sh --interactive       # prompt mode
#   WILLBUY_SERVER=user@host bash scripts/push-stripe-config.sh   # override target

set -euo pipefail

readonly REQUIRED_VARS=(
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRICE_ID_STARTER
  STRIPE_PRICE_ID_GROWTH
  STRIPE_PRICE_ID_SCALE
)

err() { printf '%s\n' "push-stripe: $*" >&2; }

prompt_for_var() {
  local name="$1"
  local prompt="$2"
  local val
  printf '%s: ' "$prompt" >&2
  IFS= read -r val
  if [[ -z "$val" ]]; then
    err "${name} cannot be empty"
    exit 2
  fi
  printf '%s' "$val"
}

mode="env"
if [[ "${1:-}" == "--interactive" ]]; then
  mode="interactive"
fi

if [[ "$mode" == "interactive" ]]; then
  err "Interactive mode — values will be sent to the server but not saved locally."
  STRIPE_SECRET_KEY=$(prompt_for_var STRIPE_SECRET_KEY        "Stripe secret key (sk_test_...)")
  STRIPE_WEBHOOK_SECRET=$(prompt_for_var STRIPE_WEBHOOK_SECRET "Webhook signing secret (whsec_...)")
  STRIPE_PRICE_ID_STARTER=$(prompt_for_var STRIPE_PRICE_ID_STARTER "Starter price ID (price_...)")
  STRIPE_PRICE_ID_GROWTH=$(prompt_for_var STRIPE_PRICE_ID_GROWTH   "Growth price ID (price_...)")
  STRIPE_PRICE_ID_SCALE=$(prompt_for_var STRIPE_PRICE_ID_SCALE     "Scale price ID (price_...)")
else
  for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
      err "${var} not set."
      err "Either run via 'op run --env-file=.env.op -- bash scripts/push-stripe-config.sh'"
      err "or use 'bash scripts/push-stripe-config.sh --interactive' to prompt."
      exit 2
    fi
  done
fi

# Resolve target host (same pattern as push-secrets.sh)
SERVER_NAME="${WILLBUY_SERVER_NAME:-willbuy-v01}"
SERVER_USER="${WILLBUY_USER:-root}"
SSH_PORT="${WILLBUY_SSH_PORT:-2223}"

if [[ -n "${WILLBUY_SERVER:-}" ]]; then
  TARGET="$WILLBUY_SERVER"
else
  : "${HCLOUD_TOKEN:?HCLOUD_TOKEN not set — run via 'op run --env-file=.env.op' or set WILLBUY_SERVER directly}"
  IPV4=$(hcloud server describe "$SERVER_NAME" -o json | jq -er '.public_net.ipv4.ip')
  TARGET="${SERVER_USER}@${IPV4}"
fi

err "Pushing Stripe config to ${TARGET}:/etc/willbuy/app.env"

# Idempotent update: replace any existing STRIPE_* line, append if missing.
# Uses Python for the in-place rewrite (more robust than sed across BSD/GNU).
ssh -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new "$TARGET" \
  "STRIPE_SECRET_KEY='${STRIPE_SECRET_KEY}' \
   STRIPE_WEBHOOK_SECRET='${STRIPE_WEBHOOK_SECRET}' \
   STRIPE_PRICE_ID_STARTER='${STRIPE_PRICE_ID_STARTER}' \
   STRIPE_PRICE_ID_GROWTH='${STRIPE_PRICE_ID_GROWTH}' \
   STRIPE_PRICE_ID_SCALE='${STRIPE_PRICE_ID_SCALE}' \
   python3 - <<'PYEOF'
import os, re, pathlib

path = pathlib.Path('/etc/willbuy/app.env')
text = path.read_text() if path.exists() else ''
keys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
        'STRIPE_PRICE_ID_STARTER', 'STRIPE_PRICE_ID_GROWTH', 'STRIPE_PRICE_ID_SCALE']
lines = text.splitlines()
seen = set()
out = []
for line in lines:
    matched = False
    for k in keys:
        if line.startswith(k + '='):
            out.append(f'{k}={os.environ[k]}')
            seen.add(k)
            matched = True
            break
    if not matched:
        out.append(line)
for k in keys:
    if k not in seen:
        out.append(f'{k}={os.environ[k]}')
path.write_text('\n'.join(out) + ('\n' if not out[-1].endswith('\n') else ''))
path.chmod(0o600)
print(f'Updated {len(keys)} STRIPE_* keys in {path}')
PYEOF
"

err "Restarting willbuy-api to pick up new env vars"
ssh -p "$SSH_PORT" "$TARGET" "systemctl restart willbuy-api"

err "Done. Test the credits flow on https://willbuy.dev/dashboard/credits"
