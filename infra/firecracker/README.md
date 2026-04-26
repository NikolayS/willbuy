# Firecracker microVM image

Builds the kernel + rootfs artifacts that Sprint 4 / Theme 1 / Firecracker #1
(issue #114) ships. The image is the substrate for the v0.2 capture-worker
isolation upgrade per spec §2 #2 and §5.13 v0.2 paragraph.

This issue produces the **artifact**. Wiring it into the worker is a
follow-up:

| Issue | Owner concern                                          |
| ----- | ------------------------------------------------------ |
| #114  | This: kernel + rootfs build pipeline.                  |
| #115  | Host bootstrap on willbuy-v01 (firecracker-bin, tap, vsock listener). |
| #116  | Capture-worker switches Unix-socket dial to AF_VSOCK.  |
| #117  | End-to-end smoke gate replacing the manual boot test.  |

## Layout

```
infra/firecracker/
├── README.md              ← this file
├── test-boot.json         ← Firecracker config for manual smoke boot
├── kernel/
│   ├── Kbuild.config      ← minimal kernel config, virtio-{net,blk,vsock} on
│   └── build-kernel.sh    ← downloads + builds Linux 6.6.55 in Docker
├── rootfs/
│   ├── Dockerfile         ← Playwright + Chromium + capture-worker baseline
│   ├── init.sh            ← PID 1; mounts pseudofs, starts vsock broker shim
│   └── build-rootfs.sh    ← exports image to ext4, gzips
└── build/                 ← (generated) vmlinux, rootfs.ext4, rootfs.ext4.gz
```

## Pinned versions

| Component       | Pin               | Rationale                                         |
| --------------- | ----------------- | ------------------------------------------------- |
| Linux kernel    | 6.6.55 (LTS)      | Firecracker-supported LTS line; vsock stable.     |
| Rootfs base     | `mcr.microsoft.com/playwright:v1.45.0-jammy` | Same userland as the Sprint 2 capture container; spec §5.13 "transport-agnostic" promise. |
| Bun runtime     | 1.3.5             | Matches `apps/capture-worker/Dockerfile`.         |

Update procedure for any of these: bump the constant in the relevant build
script + this table, run the local size + boot smoke, open a PR.

## Building

Both scripts are idempotent — re-run safely.

```sh
# 1. Kernel (~30 min on willbuy-v01; produces build/vmlinux)
bash infra/firecracker/kernel/build-kernel.sh

# 2. Rootfs (~5 min; produces build/rootfs.ext4 + .gz)
bash infra/firecracker/rootfs/build-rootfs.sh
```

The kernel build runs inside a hermetic Debian builder image; the host
only needs Docker. **Do not run on macOS**: Apple Silicon Docker emulation
makes the kernel build prohibitively slow. Use willbuy-v01 or a Linux box.

## Test-boot (manual)

```sh
# Decompress the rootfs (Firecracker reads raw ext4, not gzip).
gunzip -k infra/firecracker/build/rootfs.ext4.gz

# Bring up the tap device once (host-side, NET_ADMIN required).
sudo ip tuntap add tap-fc0 mode tap user "$(id -u)"
sudo ip addr add 169.254.0.1/30 dev tap-fc0
sudo ip link set tap-fc0 up

# Boot.
cd infra/firecracker
sudo firecracker --no-api --config-file test-boot.json
```

Expected: kernel banner → `[init] mounting pseudo-filesystems` →
`[init] broker shim ready` → capture-worker stdout. The vsock peer at
CID 2 (`VMADDR_CID_HOST`) port 5555 is bound by the host bootstrap from
issue #115; without it, the broker shim's `socat` will fail to forward
when the worker first dials.

## CI

`.github/workflows/ci.yml` job `firecracker-image` runs:
1. `shellcheck` over the three build scripts.
2. `build-kernel.sh --check-only` (validates the Kbuild.config invariants).
3. `build-rootfs.sh --check-only` (validates script syntax + Dockerfile presence).
4. `docker build` of `rootfs/Dockerfile` (verifies the image actually builds).

CI **does not** build the kernel — that's a 30+ min step requiring KVM,
which GitHub-hosted runners don't expose. The full build is a manual step
on willbuy-v01 (or, later, a beefier self-hosted runner — flagged for a
follow-up issue).

## Cosign signing — DEFERRED

The original issue body asks for cosign signatures over both artifacts.
The cosign key infra (1Password vault + GitHub Actions secret + verify
runbook) is not yet stood up; signing is intentionally **deferred** to a
follow-up issue so we don't ship an unverified key path. Once #115's host
bootstrap exists we'll add the sign + push step there. The artifact format
(raw `vmlinux` + `rootfs.ext4.gz`) is unchanged either way.

## Manager action — post-merge smoke

After merging #114, the manager runs on willbuy-v01:

1. `bash infra/firecracker/kernel/build-kernel.sh` (~30 min).
2. `bash infra/firecracker/rootfs/build-rootfs.sh` (~5 min).
3. `gunzip -k infra/firecracker/build/rootfs.ext4.gz`.
4. `sudo firecracker --no-api --config-file infra/firecracker/test-boot.json`.
5. Confirm the boot reaches `[init] broker shim ready` within 5 s wall-clock
   (spec acceptance #2). Capture the log into the issue thread.
