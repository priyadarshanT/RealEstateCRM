# syntax=docker/dockerfile:1
# API and worker image (one image, two commands). Build from the repository root:
#   docker build -f docker/api.Dockerfile -t crm-api .
# Run:     docker run --env-file api.env -p 4000:4000 crm-api              (API, GET /health)
# Worker:  docker run --env-file api.env crm-api node apps/api/dist/worker.js
# Migrate: docker run --env-file api.env crm-api node -e "require('./apps/api/dist/core/database/migrations').runMigrations(process.env.MIGRATION_DATABASE_URL, console.log).then(n => console.log(n + ' migration(s) applied'))"
# Configuration comes only from environment variables (in AWS: SSM Parameter Store); no .env file is copied.

FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @crm/api
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @crm/api build \
 && pnpm --filter @crm/api deploy --prod /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /app
# Layout mirrors the repository so dist/ finds db/migrations at the same relative path.
COPY --from=build /out/node_modules apps/api/node_modules
COPY --from=build /out/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY db/migrations db/migrations
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
