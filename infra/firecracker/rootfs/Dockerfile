# syntax=docker/dockerfile:1.7
#
# willbuy Firecracker guest rootfs (spec §2 #2 microVM isolation, §5.13 v0.2).
#
# This Dockerfile is NOT used as a deployable container image — it is a
# vehicle for assembling a filesystem tree that build-rootfs.sh exports to a
# raw ext4 image consumable by Firecracker.
#
# Pipeline (see build-rootfs.sh):
#   1. docker build -t willbuy-fc-rootfs .
#   2. docker create --name fc-extract willbuy-fc-rootfs
#   3. docker export fc-extract | tar -x -C $STAGE/
#   4. mkfs.ext4 -d $STAGE rootfs.ext4
#   5. gzip -9 rootfs.ext4
#
# Why Debian (not Alpine):
#   - Playwright's official image uses Debian (jammy → noble); Alpine's
#     musl-libc has historically broken Chromium's bundled v8 snapshot
#     (https://playwright.dev/docs/docker — "We currently do not support
#     Alpine Linux"). Sticking with Debian = same userland the Sprint 2
#     capture container uses, which is the spec §5.13 "transport-agnostic
#     by design" promise: rootfs swap, no app changes.
#   - Slim base + apt clean keeps us under the 1 GiB compressed budget.
#
# Size budget tracking (re-measure when bumping deps):
#   debian:bookworm-slim                   ~75 MiB
#   + Chromium + Playwright deps           ~450 MiB
#   + Node 20 + bun                        ~120 MiB
#   + capture-worker + node_modules        ~80 MiB
#   = ~725 MiB uncompressed, ~280 MiB gzipped (well under 1 GiB cap).

FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Same UID convention as apps/capture-worker/Dockerfile (capture:1001).
# Inside the microVM we still run the worker non-root for defence-in-depth
# even though the kernel boundary is the primary isolation.
RUN groupadd -g 1001 capture \
 && useradd -m -u 1001 -g 1001 -s /usr/sbin/nologin capture

# Tooling the playwright base image doesn't ship by contract:
#   - unzip:    required by bun's installer (without it the curl|bash below
#               silently fails to extract the bun tarball, breaking CI).
#   - socat:    relied on by init.sh for the vsock <-> tcp shim; present in
#               playwright:v1.45.0-jammy today but not part of its contract.
#   - iproute2: `ip` command used by init.sh for guest NIC bring-up; same
#               drive-by-availability caveat as socat.
# Installing them defensively keeps this image reproducible across base bumps.
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip socat iproute2 \
 && rm -rf /var/lib/apt/lists/*

# Bun for the broker-client + capture-worker entry. Pinned to match the
# host capture-worker image (apps/capture-worker/Dockerfile).
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v1.3.5" \
 && bun --version

WORKDIR /app

# Build context is the monorepo root (see build-rootfs.sh + ci.yml).
#
# Bun's workspace install needs to see the WHOLE workspace topology to
# resolve `workspace:*` references — including ones that live in devDeps
# (here: capture-worker → capture-broker, kept for type alignment, not
# imported at runtime; see apps/capture-worker/src/broker-client.ts).
# So we copy every workspace's package.json before `bun install`, even
# the ones the runtime worker doesn't import. Cheap (just metadata) and
# preserves layer caching: the install layer only invalidates when a
# package.json or the lockfile actually changes.
COPY --chown=capture:capture package.json bun.lock tsconfig.base.json ./
COPY --chown=capture:capture apps/api/package.json             ./apps/api/
COPY --chown=capture:capture apps/capture-broker/package.json  ./apps/capture-broker/
COPY --chown=capture:capture apps/capture-worker/package.json  ./apps/capture-worker/
COPY --chown=capture:capture apps/visitor-worker/package.json  ./apps/visitor-worker/
COPY --chown=capture:capture apps/web/package.json             ./apps/web/
COPY --chown=capture:capture packages/llm-adapter/package.json ./packages/llm-adapter/
COPY --chown=capture:capture packages/log/package.json         ./packages/log/
COPY --chown=capture:capture packages/shared/package.json      ./packages/shared/

# `--frozen-lockfile` is intentionally OFF here. The standard `build` CI
# job is the gate for lockfile consistency; this Dockerfile is a build
# artefact and must keep working when the lockfile shifts mid-PR (e.g.,
# after a merge from main brings new packages). If install resolves a
# different lockfile shape, the resulting rootfs is still functionally
# correct — we just don't want to fail closed on the artefact build.
RUN bun install --filter @willbuy/capture-worker --production \
 && chown -R capture:capture /app

# Now copy the worker source. Split from the install layer so source
# edits don't bust the (slow) install cache.
COPY --chown=capture:capture apps/capture-worker ./apps/capture-worker
# packages the worker imports at runtime — same pattern as apps/.
COPY --chown=capture:capture packages/log ./packages/log
COPY --chown=capture:capture packages/shared ./packages/shared
COPY --chown=capture:capture packages/llm-adapter ./packages/llm-adapter

# init.sh becomes /sbin/init inside the microVM (PID 1).
COPY --chmod=0755 infra/firecracker/rootfs/init.sh /sbin/init

# Trim things the microVM doesn't need (man pages, locales, apt caches).
# These shave ~80 MiB off the gzipped artifact.
RUN rm -rf \
      /var/lib/apt/lists/* \
      /var/cache/apt/* \
      /usr/share/man/* \
      /usr/share/doc/* \
      /usr/share/locale/* \
 && find /usr/share/i18n -mindepth 1 -maxdepth 1 \
        ! -name 'en_US*' ! -name 'en_GB*' -exec rm -rf {} + 2>/dev/null || true

# Firecracker kernel boots with `init=/sbin/init` — no CMD needed; init.sh
# does the bring-up, then exec's the worker.
