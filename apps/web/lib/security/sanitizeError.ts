// Centralised error sanitiser for /api routes.
//
// PostgreSQL / PostgREST errors are useful to operators (constraint
// names, schema fragments, CHECK violations) but also leak structure
// to attackers — they're a reconnaissance channel. The pattern was
// `NextResponse.json({ error: error.message }, { status: 500 })`
// across ~126 call sites.
//
// `sanitizeError(e, route)` does three things:
//   1. captures the full exception to Sentry with a `route` tag so
//      operators still see the detail
//   2. returns a small whitelist of public-safe codes when the error
//      can be classified (404, 403, 409, 413, 400 with a known shape)
//   3. otherwise returns a generic { error: 'internal' } / 500
//
// Use sites:
//   try { ... }
//   catch (e) { return sanitizeError(e, 'incidents/POST') }
//
//   const { data, error } = await client.from('x').select(...)
//   if (error) return sanitizeError(error, 'incidents/POST')

import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

interface PostgrestLikeError {
  code?:    string
  message?: string
  details?: string
  hint?:    string
}

const PUBLIC_SAFE_MESSAGES: Record<string, { status: number; error: string }> = {
  // PostgREST + Postgres SQLSTATE codes whose meaning is public-safe.
  // The string returned here is generic; full detail still goes to Sentry.
  '23505': { status: 409, error: 'conflict'    }, // unique_violation
  '23503': { status: 400, error: 'invalid_ref' }, // foreign_key_violation
  '23502': { status: 400, error: 'invalid_input' }, // not_null_violation
  '23514': { status: 400, error: 'invalid_input' }, // check_violation
  'PGRST116': { status: 404, error: 'not_found' }, // single() returned 0
  'PGRST301': { status: 401, error: 'unauthorized' }, // JWT issues
  '42501': { status: 403, error: 'forbidden' },   // insufficient_privilege
}

/**
 * Convert any caught exception or Postgrest error into a NextResponse
 * that is safe to send to a client. Always logs full detail to Sentry
 * with the supplied route tag.
 *
 * @param e      Caught exception or PostgrestError-like object.
 * @param route  Stable identifier ("incidents/POST", "risk/[id]/PATCH").
 */
export function sanitizeError(e: unknown, route: string): NextResponse {
  const err = e as PostgrestLikeError & { name?: string; stack?: string }

  // Always capture the full exception with a route tag — operators
  // see the real error in Sentry; the client never does.
  Sentry.captureException(e, { tags: { route, sanitized: 'true' } })

  // Map Postgrest/Postgres codes to safe public messages.
  if (err?.code && PUBLIC_SAFE_MESSAGES[err.code]) {
    const { status, error } = PUBLIC_SAFE_MESSAGES[err.code]
    return NextResponse.json({ error }, { status })
  }

  // Anything else is opaque to the client.
  return NextResponse.json({ error: 'internal' }, { status: 500 })
}

/**
 * Variant for already-classified user input errors that the route
 * has validated itself (e.g. "name too long"). Keeps the message
 * because the route author chose it explicitly — the leak risk is
 * only with raw DB errors.
 */
export function badRequest(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status })
}
