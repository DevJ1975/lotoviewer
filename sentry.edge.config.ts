// Sentry init for the Edge runtime (middleware, edge route handlers).
// We don't currently use any edge routes, but Sentry's wizard wires
// this up because adding one later would silently lose error reporting
// without it.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  })
}
