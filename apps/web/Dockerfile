# Soteria Field web app (Next.js). Build context is the REPO ROOT because the
# app depends on the packages/core workspace:
#   docker build -f apps/web/Dockerfile .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so
# they are build args, not just runtime env.

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
ENV SENTRYCLI_SKIP_DOWNLOAD=1 \
    NEXT_TELEMETRY_DISABLED=1
# Manifests first so dependency layers cache across source edits. Only the web
# workspace (and the core package it links) is installed; the Expo app is not.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci --workspace web --include-workspace-root --no-audit --no-fund

FROM deps AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
# This image is a local preview, not a store-linked deploy: the prebuild check
# for unfilled iOS/Android deep-link placeholders is waived by default.
ARG ALLOW_DEEPLINK_PLACEHOLDERS=1
ENV ALLOW_DEEPLINK_PLACEHOLDERS=$ALLOW_DEEPLINK_PLACEHOLDERS \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /repo /repo
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "--workspace", "web", "run", "start"]
