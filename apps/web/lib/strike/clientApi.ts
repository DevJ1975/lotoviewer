import { supabase } from '@/lib/supabase'

export class StrikeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Authenticated JSON call to a STRIKE API route on behalf of the signed-in learner. */
export async function strikeFetch<T>(path: string, tenantId: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new StrikeApiError('Sign in again to continue.', 401)

  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      authorization: `Bearer ${token}`,
      'x-active-tenant': tenantId,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new StrikeApiError((payload as { error?: string }).error ?? 'Request failed', res.status)
  return payload as T
}
