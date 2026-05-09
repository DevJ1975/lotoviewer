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

// Field names whose values must NEVER reach Sentry. The scrubber
// walks request data + breadcrumbs + extras and replaces values for
// any key whose name contains one of these (case-insensitive).
const SCRUB_NEEDLES = [
  'authorization', 'cookie', 'x-internal-secret', 'x-active-tenant',
  'signature_data', 'signature',
  'api_key', 'anthropic_api_key', 'voyage_api_key',
  'password', 'token', 'secret',
]

function scrub(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(scrub)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lower = k.toLowerCase()
    if (SCRUB_NEEDLES.some(s => lower.includes(s))) {
      out[k] = '[redacted]'
    } else {
      out[k] = scrub(v)
    }
  }
  return out
}

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
    // Scrub sensitive fields out of every event before it ships.
    // Auth headers, signature payloads, API keys, tenant headers —
    // any of these in a breadcrumb / request snapshot / extras
    // become "[redacted]". The DSN endpoint is public so we can't
    // rely on transport secrecy; this is the data minimisation
    // layer.
    beforeSend(event) {
      if (event.request?.headers) event.request.headers = scrub(event.request.headers) as typeof event.request.headers
      if (event.request?.data)    event.request.data    = scrub(event.request.data)
      if (event.request?.cookies) event.request.cookies = scrub(event.request.cookies) as typeof event.request.cookies
      if (event.extra)            event.extra           = scrub(event.extra) as typeof event.extra
      if (event.contexts)         event.contexts        = scrub(event.contexts) as typeof event.contexts
      return event
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data) crumb.data = scrub(crumb.data) as typeof crumb.data
      return crumb
    },
  })
}

// Required export so router transitions are captured for performance.
export const onRouterTransitionStart = dsn
  ? Sentry.captureRouterTransitionStart
  : undefined
