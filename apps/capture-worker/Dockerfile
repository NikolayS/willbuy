# syntax=docker/dockerfile:1.7
#
# willbuy capture-worker — hardened container baseline (spec §2 #2).
#
# What this image provides:
#  - Playwright + Chromium pinned to 1.45.0 via the Microsoft base image
#  - Non-root UID 1001 with no shell login + no home-dir writes outside tmpfs
#  - Capture-worker source under /app, owned by 1001
#
# What this image deliberately does NOT do (Sprint 2 follow-ups):
#  - iptables / network-namespace egress allow-list (§5.13 v0.1 transport)
#  - bind-mount of the broker Unix socket
#  - cgroup memory/CPU caps (apply at `docker run` / k8s level)
#  - cookie-banner DOM removal (§2 #7)
#  - screenshot + OCR scrub (§5.17 opt-in)
#
# Runtime invocation (the deploy manifest will set these — REPRODUCE in any
# manual smoke run, since the in-image hardening is not enough on its own):
#
#   docker run --rm \
#     --user 1001:1001 \
#     --read-only \
#     --tmpfs /tmp:rw,nosuid,nodev,size=64m \
#     --tmpfs /dev/shm:rw,nosuid,nodev,size=128m \
#     --cap-drop ALL \
#     --security-opt no-new-privileges \
#     --security-opt seccomp=infra/seccomp/capture.json \   # Sprint 2
#     --network=capture-egress-restricted \                 # Sprint 2
#     --memory=1g --cpus=1 \
#     willbuy-capture-worker:<sha> \
#     node /app/dist/smoke.js https://example.com
#
# Chromium's own sandbox layers stay enabled. The sandbox-disabling Chromium
# flag is BANNED across this repo; the CI lint `willbuy/no-sandbox-flag`
# blocks PRs that try to add it. Do not work around the lint.

FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# The base image already has a non-root `pwuser` (UID 1000); we add a
# dedicated `capture` UID 1001 so the broker socket group membership is
# unambiguous and doesn't collide with anything Microsoft might add.
RUN groupadd -g 1001 capture \
 && useradd -m -u 1001 -g 1001 -s /usr/sbin/nologin capture

WORKDIR /app

# Copy only what we need (no .git, no node_modules from the dev host).
# The build context is the monorepo root so we can pick up the lockfile.
COPY --chown=capture:capture pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --chown=capture:capture apps/capture-worker ./apps/capture-worker

# Production install (no devDeps; Playwright browsers come from the base
# image so we don't re-download them). pnpm is already on the base path
# via the Playwright image's Node setup; install via npx if not.
RUN corepack enable \
 && corepack prepare pnpm@10.28.2 --activate \
 && pnpm install --filter @willbuy/capture-worker --frozen-lockfile --prod \
 && chown -R capture:capture /app

USER 1001:1001

# Default command is a no-op; the orchestrator drives the worker via the
# broker. Smoke / manual runs override CMD.
CMD ["node", "-e", "console.log('willbuy-capture-worker ready')"]
