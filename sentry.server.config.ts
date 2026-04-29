// Sentry init for the Node.js server runtime (API routes, server
// components, server actions). Loaded by instrumentation.ts.
//
// Disabled when SENTRY_DSN is not set so local dev and any deploy
// that hasn't been wired up yet runs without errors.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    // 10% of transactions sampled in production. Override via
    // SENTRY_TRACES_SAMPLE_RATE if you need more or fewer.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Tag every event with the environment so prod/preview/dev
    // are easy to filter in the Sentry UI.
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    // Surface our Vercel deploy SHA so we can pin a regression to
    // an exact build. NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA is set
    // automatically by Vercel.
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Drop noisy errors that aren't actionable.
    ignoreErrors: [
      // Network errors during PWA service-worker fetches.
      'NetworkError',
      'Failed to fetch',
    ],
  })
}
