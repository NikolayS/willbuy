# syntax=docker/dockerfile:1.7
# willbuy.dev web — Next.js 14 standalone, multi-stage, non-root, healthcheck on /.
# SPEC §4.1 component.

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @willbuy/web...

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
COPY --from=deps /repo /repo
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @willbuy/web build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Non-root user. Next standalone server is a plain node script; nothing
# needs root inside the container.
RUN addgroup -S willbuy && adduser -S -G willbuy willbuy

# Next.js standalone output bundles only what the server needs.
COPY --from=build --chown=willbuy:willbuy /repo/apps/web/.next/standalone ./
COPY --from=build --chown=willbuy:willbuy /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=willbuy:willbuy /repo/apps/web/public ./apps/web/public

USER willbuy
EXPOSE 3000

# Healthcheck on / (marketing landing). The endpoint is unauthenticated
# and stable; per SPEC §5.10 it carries the relaxed CSP.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
