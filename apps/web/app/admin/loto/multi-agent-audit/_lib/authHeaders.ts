import { supabase } from '@/lib/supabase'

// Bearer token + active-tenant header for the authed admin audit API. Mirrors
// the inline helper in app/admin/loto/public-review-link/page.tsx, lifted here
// because both audit pages (the run list and the run detail) need it — refresh
// the session when it's within the expiry window so a long-lived tab doesn't
// 401 mid-audit.
const SESSION_REFRESH_WINDOW_MS = 2 * 60 * 1000

export async function authHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session: current } } = await supabase.auth.getSession()
  let session = current
  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0
  if (!session?.access_token || expiresAtMs <= Date.now() + SESSION_REFRESH_WINDOW_MS) {
    const { data, error } = await supabase.auth.refreshSession()
    if (error) throw new Error('Your session expired. Please refresh the page.')
    session = data.session
  }
  if (!session?.access_token) throw new Error('Sign in expired — refresh the page.')
  return {
    'Authorization':   `Bearer ${session.access_token}`,
    'x-active-tenant': tenantId,
  }
}
