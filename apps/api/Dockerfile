# syntax=docker/dockerfile:1.7

# --- deps ---
FROM oven/bun:1.3.5-debian AS deps
WORKDIR /app
COPY bun.lockb package.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN bun install --frozen-lockfile --filter @willbuy/api

# --- build ---
FROM oven/bun:1.3.5-debian AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY tsconfig.base.json package.json ./
COPY apps/api ./apps/api
RUN cd apps/api && bun run build

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN groupadd --system --gid 1001 willbuy \
 && useradd --system --uid 1001 --gid 1001 --no-create-home willbuy
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
USER 1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]
