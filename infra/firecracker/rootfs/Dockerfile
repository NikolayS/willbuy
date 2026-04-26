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

# Bun for the broker-client + capture-worker entry. Pinned to match the
# host capture-worker image (apps/capture-worker/Dockerfile).
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v1.3.5" \
 && bun --version

WORKDIR /app

# Copy worker source + lockfile. Build context is the monorepo root.
COPY --chown=capture:capture bun.lock package.json ./
COPY --chown=capture:capture apps/capture-worker ./apps/capture-worker

RUN bun install --filter @willbuy/capture-worker --frozen-lockfile --production \
 && chown -R capture:capture /app

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
