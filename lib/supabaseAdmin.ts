import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Server-only Supabase client that uses the service role key. NEVER import
// this file from a client component — the service role bypasses RLS and
// must not ship in the browser bundle.
//
// Requires env:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (server-only, do NOT prefix with NEXT_PUBLIC_)
let cached: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}

// Cryptographically-random temp password. Shown once to the admin in the
// invitation template and marked must_change_password=true so the user is
// forced to rotate it on first login.
export function generateTempPassword(length = 14): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*'
  const buf = new Uint8Array(length)
  crypto.getRandomValues(buf)
  let out = ''
  for (const b of buf) out += charset[b % charset.length]
  return out
}
