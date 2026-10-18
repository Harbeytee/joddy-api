# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.13.0

# ---- deps: full install (dev deps are needed to generate the Prisma client and compile)
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# argon2's prebuilt linux-arm64 binary segfaults on some hosts, so compile it for this image.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts \
  && npm_config_nodedir=/usr/local npm rebuild argon2 --build-from-source

# ---- build: generate the Prisma client and compile TypeScript
FROM deps AS build
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
  && npm run build

# ---- migrate: one-off job that applies pending migrations (`docker compose run --rm migrate`)
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts ./
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- prod-deps: runtime dependencies only (pruned from the full install, no second download)
FROM deps AS prod-deps
RUN npm prune --omit=dev --ignore-scripts

# ---- runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

# ---- worker: the apply worker, with the Chromium it drives
FROM runtime AS worker
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* \
  && chown -R node:node /ms-playwright
USER node
HEALTHCHECK NONE
CMD ["node", "dist/worker.js"]
