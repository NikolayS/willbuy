#!/usr/bin/env bash
# One-shot setup for GitHub Actions auto-deploy.
# Run this from your laptop ONCE. Requires: 1Password agent unlocked + gh CLI.
#
# What it does:
#   1. Generates an SSH keypair locally
#   2. Pushes the public key to willbuy-v01 (uses your 1Password agent — Touch ID prompt)
#   3. Stores private key + host as GitHub Actions secrets
#   4. Triggers a manual deploy run
#   5. Cleans up local key copies
#
# Result: every future merge to main auto-deploys to willbuy.dev.

set -euo pipefail

REPO="NikolayS/willbuy"
HOST="${WILLBUY_HOST:-87.99.135.213}"
PORT="${WILLBUY_SSH_PORT:-2223}"
KEY="$(mktemp -d)/willbuy-deploy"

cleanup() { rm -rf "$(dirname "$KEY")"; }
trap cleanup EXIT

echo "→ Generating dedicated deploy keypair (ed25519)…"
ssh-keygen -t ed25519 -f "$KEY" -N "" -C "github-actions-deploy@willbuy" -q

echo "→ Authorizing public key on willbuy-v01 (Touch ID prompt incoming)…"
ssh -p "$PORT" -o StrictHostKeyChecking=accept-new "root@$HOST" \
  "mkdir -p /root/.ssh && cat >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys" \
  < "$KEY.pub"

echo "→ Storing GitHub Actions secrets…"
gh secret set DEPLOY_SSH_KEY --repo "$REPO" < "$KEY"
gh secret set DEPLOY_HOST    --repo "$REPO" --body "$HOST"

echo "→ Triggering first deploy…"
gh workflow run deploy.yml --repo "$REPO"
sleep 3
gh run list --workflow=deploy.yml --repo "$REPO" --limit 1

echo
echo "✓ Auto-deploy is set up. Watch progress:"
echo "  gh run watch --repo $REPO"
echo
echo "Future deploys: every push to main triggers automatically."
echo "Manual trigger: gh workflow run deploy.yml --repo $REPO"
