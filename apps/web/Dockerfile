# syntax=docker/dockerfile:1
#
# Production image for the Next.js web app. Build from the REPOSITORY ROOT,
# because the app depends on packages/core and the build checks read scripts/:
#
#   docker build -f apps/web/Dockerfile -t soteria-web .
#
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so an
# image is built per environment. Server-side settings are read at run time.
ARG NODE_VERSION=22

# ── Dependencies ────────────────────────────────────────────────────────
# Only the web workspace and what it depends on, so the mobile app's large
# dependency tree is never installed.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/core/package.json packages/core/
RUN npm ci --workspace web --include-workspace-root --no-audit --no-fund --ignore-scripts

# ── Build ───────────────────────────────────────────────────────────────
FROM deps AS build
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ARG NEXT_PUBLIC_APP_URL=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ARG ALLOW_DEEPLINK_PLACEHOLDERS=""
ENV NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY} \
    ALLOW_DEEPLINK_PLACEHOLDERS=${ALLOW_DEEPLINK_PLACEHOLDERS}
COPY scripts scripts
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm --workspace web run build

# ── Run ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /srv

# server.js does not copy these by itself (Next docs: output > standalone).
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# Folders the app reads from disk at request time; file tracing cannot see
# them because the paths are built from process.cwd().
COPY --from=build --chown=node:node /repo/apps/web/migrations ./apps/web/migrations
COPY --from=build --chown=node:node /repo/apps/web/seed ./apps/web/seed
COPY --from=build --chown=node:node /repo/apps/web/lib/support/kb ./apps/web/lib/support/kb

USER node
EXPOSE 3000
# /login is public and needs no database, so it reports whether the server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
