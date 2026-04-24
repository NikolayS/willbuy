#!/usr/bin/env bash
# Push server-local secrets from 1Password-resolved env vars.
# Invoke as:
#   op run --env-file=.env.op -- scripts/push-secrets.sh
# so RESEND_API_KEY and HCLOUD_TOKEN are populated by `op run` and never
# touch a checked-in file, shell history, or log.
#
# Server identifier: the STABLE NAME (default `willbuy-v01`). The IP is
# resolved at runtime from the Hetzner API using HCLOUD_TOKEN, so server
# re-creations, reboots, or floating-IP moves don't require a script edit.
#
# Overrides (for one-off use against a non-default host):
#   WILLBUY_SERVER_NAME=<hcloud-server-name>   # default: willbuy-v01
#   WILLBUY_SERVER=<user>@<host-or-ip>         # bypasses the hcloud lookup
#   WILLBUY_USER=<user>                        # default: root

set -euo pipefail

: "${RESEND_API_KEY:?RESEND_API_KEY not set — run via op run --env-file=.env.op}"
: "${HCLOUD_TOKEN:?HCLOUD_TOKEN not set — run via op run --env-file=.env.op}"

SERVER_NAME="${WILLBUY_SERVER_NAME:-willbuy-v01}"
SERVER_USER="${WILLBUY_USER:-root}"

if [[ -n "${WILLBUY_SERVER:-}" ]]; then
  TARGET="$WILLBUY_SERVER"
else
  # HCLOUD_TOKEN is picked up by hcloud CLI from the environment.
  IPV4=$(hcloud server describe "$SERVER_NAME" -o json \
         | jq -er '.public_net.ipv4.ip')
  TARGET="${SERVER_USER}@${IPV4}"
fi

ssh -o StrictHostKeyChecking=accept-new "$TARGET" \
  "install -d -m 700 -o root -g root /etc/willbuy && \
   install -m 600 -o root -g root /dev/stdin /etc/willbuy/secrets.env" <<EOF
# Server-local secrets. Mode 0600. Rendered from 1Password vault 'willbuy'.
# Do NOT edit by hand; re-run scripts/push-secrets.sh to refresh.
RESEND_API_KEY=${RESEND_API_KEY}
HCLOUD_TOKEN=${HCLOUD_TOKEN}
EOF

echo "secrets pushed to $TARGET:/etc/willbuy/secrets.env"
ssh "$TARGET" "ls -la /etc/willbuy/secrets.env && wc -c /etc/willbuy/secrets.env"
