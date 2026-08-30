import { supabase } from '@/lib/supabase'

// Helpers for the handful of mobile flows that go through the Next.js web API
// (AI assistant, risk create, JHA breakdown) rather than talking to Supabase
// directly. The header shape mirrors the web client; the routes' tenant gate
// reads the bearer token + x-active-tenant.

// Resolve the web origin to POST to. Throws when unset so a misconfigured
// build fails loudly instead of fetching a relative "/api/..." that 404s.
export function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? ''
  if (!base) throw new Error('EXPO_PUBLIC_WEB_ORIGIN is not set; cannot reach the web API.')
  return base.replace(/\/$/, '')
}

// Bearer (Supabase JWT) + active-tenant headers every tenant-scoped route
// requires. Async because the token comes from the current Supabase session.
export async function authHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = {
    'content-type':    'application/json',
    'x-active-tenant': tenantId,
  }
  if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
  return headers
}
