import { apiBase, authHeaders } from '@/lib/api'
import { supabase } from '@/lib/supabase'

// In-app account deletion (App Store guideline 5.1.1(v)). The request is
// queued server-side rather than executed: safety records are retained for
// OSHA recordkeeping and anonymized when support completes it.

export async function pendingDeletionRequestedAt(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('account_deletion_requests')
    .select('requested_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle()
  return (data?.requested_at as string | undefined) ?? null
}

export async function requestAccountDeletion(tenantId: string, reason: string | null): Promise<string> {
  const res = await fetch(`${apiBase()}/api/users/me/deletion-request`, {
    method:  'POST',
    headers: await authHeaders(tenantId),
    body:    JSON.stringify({ reason }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body.requestedAt as string
}
