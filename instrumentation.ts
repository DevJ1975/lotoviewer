// Next.js instrumentation hook — runs once per server / edge runtime
// boot. Loads the matching Sentry config so error reporting is wired
// before any request handler runs.
//
// onRequestError is the App-Router-friendly way to report unhandled
// errors thrown during render (replaces the older _error.js path).

import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
