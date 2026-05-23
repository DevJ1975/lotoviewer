import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'

// Read/write helpers for the email_suppressions table (migration 195).
// Service-role only — callers pass a supabaseAdmin() client.

// Returns the set of lower-cased email addresses that have opted out of the
// given bulk category (or of everything via 'all'). Fail-open: on a read
// error we return an empty set so a transient DB blip can't silence an entire
// weekly digest — it's logged to Sentry instead.
export async function loadSuppressedEmails(admin: SupabaseClient, category: string): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    const { data, error } = await admin
      .from('email_suppressions')
      .select('email')
      .in('category', ['all', category])
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as { email: string }[]) out.add(r.email.toLowerCase())
  } catch (e) {
    Sentry.captureException(e, { tags: { source: 'email-suppression', op: 'load', category } })
  }
  return out
}

// Records an opt-out. Idempotent via the (email, category) unique constraint.
export async function recordSuppression(
  admin: SupabaseClient,
  email: string,
  category: string,
  source: 'user' | 'bounce' | 'complaint' = 'user',
): Promise<boolean> {
  const { error } = await admin
    .from('email_suppressions')
    .upsert({ email: email.toLowerCase(), category, source }, { onConflict: 'email,category', ignoreDuplicates: true })
  if (error) {
    Sentry.captureException(new Error(error.message), { tags: { source: 'email-suppression', op: 'record', category } })
    return false
  }
  return true
}
