# infra — willbuy.dev

Minimal infrastructure state. Secrets live ONLY on the server at `/etc/willbuy/secrets.env` (mode 0600); they are **never** committed here.

## Active resources

### Cloudflare — PostgresAI account

| Resource | Identifier                           | Notes                                                       |
|----------|--------------------------------------|-------------------------------------------------------------|
| Zone     | `willbuy.dev` · id `723d583d49c6ab84c134b8e814b942e5` | Active. Free plan. API token scoped to this zone only (DNS / DNS Settings / Zone Settings / SSL and Certificates — Edit). |

### Hetzner Cloud — project `SAMO` (TODO: move to dedicated `willbuy` project post-launch)

| Resource | ID         | Name            | Notes                                                  |
|----------|------------|-----------------|--------------------------------------------------------|
| Server   | 127951914  | `willbuy-v01`   | CPX21 · Ashburn (ash) · Ubuntu 24.04 · 3 vCPU / 4 GB / 80 GB / 1 TB traffic |
| Firewall | 10887833   | `willbuy-v01-fw`| Allow: 22/tcp, 80/tcp, 443/tcp, icmp — IPv4+IPv6 · deny all else |
| SSH key  | 106530191  | `nik@postgres.ai` | ed25519; matches `~/.ssh/id_ed25519`                 |

### Server endpoints

Address is looked up at runtime from Hetzner — the stable identifier is the server name `willbuy-v01`. IPs are not checked in; they rotate whenever Hetzner recreates the host.

```sh
# Ad-hoc SSH
op run --env-file=.env.op -- bash -c \
  'ssh willbuy@$(hcloud server describe willbuy-v01 -o json | jq -r .public_net.ipv4.ip)'

# Programmatic consumers (push-secrets.sh etc.) do the same lookup internally.
```

### Installed at bootstrap (2026-04-24)

- Docker 29.4.1 + compose-plugin + buildx
- git, jq, make, tmux, vim, curl, ca-certificates
- `ufw` present (not enabled — Hetzner Cloud firewall is the source of truth)
- `fail2ban` enabled
- `unattended-upgrades` configured for security-only autoupdates
- Non-root user `willbuy` in `sudo` and `docker` groups, SSH key copied from root

## Not done yet (next steps for Sprint 0)

- Attach Cloudflare in front of `willbuy.dev` (DNS + SSL + WAF)
- Clone repo on server under `/srv/willbuy`
- Self-hosted Supabase bring-up via its official `docker-compose.yml`
- App / API / capture-worker / broker containers
- Preview-env-per-PR provisioning (simplified per spec §2 #25)
- Resend integration (transactional email — spec §5.6 / §5.12 / §8)

## Secrets policy

- **Repo is public.** No secret ever enters this repo.
- Canonical source: **1Password vault `willbuy`** (personal account `my.1password.com`). Item titles match the `op://` paths in `.env.op`.
- Server-local cache: `/etc/willbuy/secrets.env`, mode 0600, owned by root. Written only by `scripts/push-secrets.sh` invoked through `op run --env-file=.env.op` — values are streamed over SSH stdin and never touch a shell variable, local file, or log.
- Containers read via `--env-file /etc/willbuy/secrets.env` or docker secrets.
- Preview envs get a dedicated sub-key per spec §2 #25.
- Any secret that appears in a chat/IM/email/commit message is treated as **burned** — rotate immediately.

### Refreshing server secrets after a vault update

```sh
cd ~/github/willbuy
op run --env-file=.env.op -- scripts/push-secrets.sh
```

Pre-reqs: `OP_ACCOUNT=my.1password.com` exported (already persisted in `~/.zshrc`), 1Password desktop app unlocked, `op` CLI installed, SSH key authorized on the server.

### Rotation reminder

Both the Hetzner token and Resend key were originally pasted in chat. The chat-exposed values have been replaced in the vault; confirm that the **old** values are also revoked at the provider dashboards (Hetzner Console → Security → API Tokens; Resend Dashboard → API Keys) so they stop working server-side, not just locally.

## Reproducing this server

The bootstrap was a one-shot SSH-heredoc (see commit history). Sprint 0 will replace it with a proper IaC script — either a shell script under `infra/bootstrap.sh` or a Terraform module under `infra/terraform/`. Until then, the steps are preserved in the commit message of this file.
