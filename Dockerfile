# syntax=docker/dockerfile:1.7
# Production image for apps/web (Next.js, standalone output).
#
#   deps    – npm ci; cached until a manifest or the lockfile changes
#   builder – next build
#   runner  – standalone server only, as a non-root user
#
# Build-time configuration arrives as a BuildKit secret holding a dotenv file
# (see .github/workflows/deploy-web-aws.yml). Two reasons it is not ARG/ENV:
#   1. SENTRY_AUTH_TOKEN never lands in an image layer or `docker history`.
#   2. NEXT_PUBLIC_* values are inlined into the JS bundle at build time, and
#      an unset ARG becomes an empty string, which the app's `?? fallback`
#      code treats as a real value. A dotenv file only carries keys that are set.

# Docker Hub's official image via AWS's mirror, which has no anonymous pull
# rate limit (Docker Hub's 429s otherwise fail CI builds at random).
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:20-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json      ./apps/web/
COPY apps/mobile/package.json   ./apps/mobile/
COPY packages/core/package.json ./packages/core/
# @sentry/cli's postinstall downloads a binary that is only needed to upload
# source maps; the builder stage gets it through the npm package instead.
RUN SENTRYCLI_SKIP_DOWNLOAD=1 npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
# Copy the whole tree, not just the root node_modules: npm may leave
# non-hoisted packages in apps/*/node_modules.
COPY --from=deps /app ./
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Switches next.config.ts to `output: 'standalone'`, which the runner stage needs.
ENV NEXT_STANDALONE_OUTPUT=1
# The .well-known / eas.json files still carry REPLACE_WITH_… placeholders
# pending the mobile store rollout (D2.1, D2.2); CI and Vercel set the same flag.
ENV ALLOW_DEEPLINK_PLACEHOLDERS=1
ARG BUILD_ITERATION=0
ENV BUILD_ITERATION=${BUILD_ITERATION}
# Secret mounts are not part of the layer cache key. Hashing the build env
# file into an ARG makes a changed NEXT_PUBLIC_* value force a rebuild.
ARG BUILD_ENV_HASH=none
RUN --mount=type=secret,id=build_env,target=/app/apps/web/.env.production,required=false \
    npm run build --workspace=web

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# In a monorepo the standalone bundle mirrors the repo layout, so the entry
# point is apps/web/server.js. Static assets and public/ are not part of the
# bundle and must sit next to it.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static     ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public           ./apps/web/public

# Read from disk at request time via process.cwd() (server.js chdirs into
# apps/web), so output file tracing cannot see them:
#   lib/support/kb – support assistant knowledge base   (lib/support/kb.ts)
#   seed           – regulation seed corpus             (api/superadmin/knowledge/seed-regulations)
#   migrations     – migration browser                  (superadmin/migrations)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/lib/support/kb ./apps/web/lib/support/kb
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/seed           ./apps/web/seed
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/migrations     ./apps/web/migrations

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
