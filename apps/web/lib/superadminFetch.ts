// Wrapper around fetch that injects the caller's Supabase access token
// as a Bearer auth header. Used by every client-side call to a
// /api/superadmin/* route — those routes use requireSuperadmin() which
// reads `Authorization: Bearer <token>`.
//
// Throws a typed error on missing session so the caller's catch block
// can render a clean "Not signed in" message instead of a TypeErrors
// from `headers.set` on undefined.

import { supabase } from '@/lib/supabase'

export class NotSignedInError extends Error {
  constructor() { super('Not signed in') }
}

export async function superadminFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new NotSignedInError()

  const headers = new Headers(init?.headers ?? {})
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

// Common pattern: POST/PATCH JSON to a superadmin endpoint and parse
// the JSON body. Returns { ok, status, body, error? } so callers don't
// have to repeat the try/catch + .json() dance every time.
export async function superadminJson<T = unknown>(
  input: RequestInfo | URL,
  init: RequestInit & { body?: BodyInit },
): Promise<{ ok: boolean; status: number; body: T | null; error: string | null }> {
  try {
    const headers = new Headers(init.headers ?? {})
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    const res = await superadminFetch(input, { ...init, headers })
    let body: T | null = null
    try { body = await res.json() as T } catch { /* non-JSON body is fine */ }
    if (!res.ok) {
      const err = (body as { error?: unknown } | null)?.error
      return {
        ok:     false,
        status: res.status,
        body,
        error:  typeof err === 'string' ? err : `Request failed (${res.status})`,
      }
    }
    return { ok: true, status: res.status, body, error: null }
  } catch (err) {
    if (err instanceof NotSignedInError) {
      return { ok: false, status: 401, body: null, error: 'Not signed in' }
    }
    return {
      ok:     false,
      status: 0,
      body:   null,
      error:  err instanceof Error ? err.message : 'Network error',
    }
  }
}
