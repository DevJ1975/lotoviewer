import { supabase } from '@/lib/supabase'

// Shared fetch helper for the /compliance/* client pages. Attaches
// the bearer token + x-active-tenant header so every call lands on
// the tenant-gated API routes correctly.

export async function complianceFetch<T = unknown>(
  tenantId: string,
  path:     string,
  init?:    RequestInit,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = {
    'x-active-tenant': tenantId,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
  if (init?.body && !headers['content-type']) headers['content-type'] = 'application/json'

  const res = await fetch(path, { ...init, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body as T
}
