import { createClient } from '@supabase/supabase-js'

export interface SupervisorSession {
  accessToken: string
  email: string
  signOut: () => Promise<void>
}

/**
 * Signs a supervisor in on the worker's device without touching the
 * worker's own session: a throwaway in-memory client, nothing persisted, so
 * closing the tab or signing the record leaves the device as it was.
 */
export async function signInSupervisor(email: string, password: string): Promise<SupervisorSession> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Sign-in is not configured.')
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'strike-supervisor-signoff' },
  })
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password })
  if (error || !data.session) throw new Error('That email and password didn’t work.')
  return {
    accessToken: data.session.access_token,
    email: data.user.email ?? email.trim(),
    signOut: async () => { await client.auth.signOut() },
  }
}
