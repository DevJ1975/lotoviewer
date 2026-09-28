# syntax=docker/dockerfile:1
#
# Production image for the Soteria Field web app (apps/web).
#
# Build from the REPO ROOT (the whole monorepo is the build context, because
# apps/web depends on the packages/core workspace):
#
#   docker build -f apps/web/Dockerfile -t soteria-web:latest .
#   docker run --rm -p 3000:3000 --env-file apps/web/.env.local soteria-web:latest
#
# The app deploys to Vercel in production; this image is for local runs,
# self-hosting, or CI parity. Supabase/Anthropic/Resend keys are provided at
# RUN time via env (never baked into the image).
FROM node:20-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    # @sentry/cli's postinstall downloads a binary only needed for build-time
    # source-map upload, not to compile the app; skip it (matches CI).
    SENTRYCLI_SKIP_DOWNLOAD=1

# Install against the lockfile with only the workspace manifests present first,
# so the (slow) dependency layer is cached until a package.json changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
RUN npm ci

# Now the sources and the production build.
COPY . .
ENV ALLOW_DEEPLINK_PLACEHOLDERS=1
RUN npm run build

# ── Runner ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
# next.config has no `output: standalone`, so ship the built workspace and run
# `next start`. (Enable standalone later for a much smaller image.)
COPY --from=build /app ./
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npm", "run", "start"]
