#!/usr/bin/env bash
# One-shot setup for GitHub Actions auto-deploy.
# Run this from your laptop ONCE. Requires: 1Password agent unlocked + gh CLI.
#
# What it does:
#   1. Pre-flight checks (gh auth, ssh, ssh-keygen, willbuy-v01 reachable)
#   2. Generates an SSH keypair locally (ed25519)
#   3. Pushes the public key to willbuy-v01 (1Password Touch ID prompt)
#   4. Stores private key + host as GitHub Actions secrets
#   5. Triggers the first deploy run
#   6. Cleans up local key copies
#
# Result: every future merge to main auto-deploys to willbuy.dev.

set -euo pipefail

REPO="${WILLBUY_REPO:-NikolayS/willbuy}"
HOST="${WILLBUY_HOST:-87.99.135.213}"
PORT="${WILLBUY_SSH_PORT:-2223}"

err() { printf '%s\n' "ERROR: $*" >&2; }
ok()  { printf '%s\n' "$*"; }

# ── Pre-flight ──────────────────────────────────────────────────────────────

ok "→ Pre-flight checks…"

if ! command -v ssh-keygen >/dev/null 2>&1; then
  err "ssh-keygen not found"; exit 1
fi
if ! command -v ssh >/dev/null 2>&1; then
  err "ssh not found"; exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  err "gh CLI not found — install from https://cli.github.com/"; exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  err "gh CLI is not authenticated. Run: gh auth login"
  exit 1
fi

# Verify gh has access to the target repo (catches typos in WILLBUY_REPO)
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  err "Cannot access GitHub repo '$REPO'. Check repo name and that 'gh auth' has access."
  exit 1
fi

# Verify willbuy-v01 SSH port is reachable BEFORE generating keys.
# Permission-denied is fine here — means the port is open and SSH responds.
ok "→ Checking willbuy-v01 SSH reachability on $HOST:$PORT…"
ssh_probe=$(ssh -p "$PORT" -o ConnectTimeout=8 -o BatchMode=yes -o StrictHostKeyChecking=no \
  "root@$HOST" exit 2>&1 || true)
if echo "$ssh_probe" | grep -qE "Connection timed out|Connection refused|No route|Network is unreachable"; then
  err "Cannot reach $HOST:$PORT — '$ssh_probe'"
  err "If the VM was rebuilt, the IP may have changed. Override with WILLBUY_HOST=<ip>."
  exit 1
fi
ok "  reachable."

# ── Generate keypair ────────────────────────────────────────────────────────

KEY="$(mktemp -d)/willbuy-deploy"
cleanup() { rm -rf "$(dirname "$KEY")"; }
trap cleanup EXIT

ok "→ Generating dedicated deploy keypair (ed25519)…"
ssh-keygen -t ed25519 -f "$KEY" -N "" -C "github-actions-deploy@willbuy" -q

# ── Authorize on server (1Password Touch ID prompt) ─────────────────────────

ok "→ Authorizing public key on willbuy-v01."
ok "  ⚠  Touch ID prompt incoming — your 1Password agent must be unlocked."
ssh -p "$PORT" -o StrictHostKeyChecking=accept-new "root@$HOST" \
  "mkdir -p /root/.ssh && cat >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys" \
  < "$KEY.pub"

# Verify the new key actually works (sanity check before storing as secret)
ok "→ Verifying new key works…"
if ! ssh -i "$KEY" -p "$PORT" -o BatchMode=yes -o IdentitiesOnly=yes \
     -o StrictHostKeyChecking=accept-new \
     "root@$HOST" "echo OK" >/dev/null 2>&1; then
  err "Key authorization succeeded but key auth failed on follow-up. Aborting."
  exit 1
fi
ok "  verified."

# ── Store secrets ────────────────────────────────────────────────────────────

ok "→ Storing GitHub Actions secrets in $REPO…"
gh secret set DEPLOY_SSH_KEY --repo "$REPO" < "$KEY"
gh secret set DEPLOY_HOST    --repo "$REPO" --body "$HOST"

# ── First deploy ────────────────────────────────────────────────────────────

ok "→ Triggering first deploy…"
gh workflow run deploy.yml --repo "$REPO" --ref main

# Wait briefly for the run to register, then surface its URL
sleep 4
run_url=$(gh run list --workflow=deploy.yml --repo "$REPO" --limit 1 --json url --jq '.[0].url' 2>/dev/null || echo "")

ok ""
ok "✓ Auto-deploy is set up."
[[ -n "$run_url" ]] && ok "  Watch first deploy: $run_url"
ok "  Or: gh run watch --repo $REPO"
ok ""
ok "From now on:"
ok "  - Every push to main auto-deploys to willbuy.dev"
ok "  - Manual deploy: gh workflow run deploy.yml --repo $REPO"
ok ""
ok "Smoke test runs at the end of each deploy. Workflow goes red if not 8/8."
