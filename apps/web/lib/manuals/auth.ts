import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Auth helper for /api/manuals/*. Manuals are platform-wide so we
// don't go through tenantGate (no x-active-tenant header required).
// Just validate the bearer token and probe for the superadmin flag,
// which gates draft visibility on read paths.

export type ManualReader =
  | { ok: true; userId: string; email: string | null; isSuperadmin: boolean }
  | { ok: false; status: number; message: string }

export async function requireManualReader(req: Request): Promise<ManualReader> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Missing bearer token' }
  }
  const token = authHeader.slice('Bearer '.length)
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { ok: false, status: 500, message: 'Supabase env not configured' }
  }

  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, message: 'Invalid session' }

  const admin = supabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .maybeSingle()
  const dbFlag = !!(profile as { is_superadmin: boolean } | null)?.is_superadmin
  const allow = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const envAllowed = !!user.email && allow.includes(user.email.toLowerCase())
  // Both gates required to expose drafts — same posture as
  // requireSuperadmin, just extracted here so read routes don't have
  // to import from /superadmin auth helper.
  return {
    ok: true,
    userId: user.id,
    email: user.email ?? null,
    isSuperadmin: dbFlag && envAllowed,
  }
}
