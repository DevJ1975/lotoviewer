// Sentry init for the browser. Picked up automatically by Next.js
// 15.3+ (you don't import this from anywhere — Next looks for the
// file at the project root).
//
// Reads NEXT_PUBLIC_SENTRY_DSN — public-prefixed because the DSN ships
// to every browser that loads the app. The DSN itself isn't a secret;
// it's a write-only ingest endpoint for THIS project. Anyone with it
// can submit events but can't read your error data.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Replay is opt-in via env so you can ship Sentry without the
    // additional bundle weight until you actually want session replays.
    replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE ?? 0),
    replaysOnErrorSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_ERROR_SAMPLE_RATE ?? 0),
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    integrations: [
      // Browser tracing is on by default; explicit so the intent is
      // visible if someone reads this file before the docs.
      Sentry.browserTracingIntegration(),
    ],
    ignoreErrors: [
      'NetworkError',
      'Failed to fetch',
      // ResizeObserver loop errors — a known browser quirk that
      // Sentry rates as low priority anyway.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications.',
    ],
  })
}

// Required export so router transitions are captured for performance.
export const onRouterTransitionStart = dsn
  ? Sentry.captureRouterTransitionStart
  : undefined
