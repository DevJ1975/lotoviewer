import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Server-side guard for /api/superadmin/* routes. Both checks must pass:
//   1. Caller's profiles.is_superadmin = true (DB flag)
//   2. Caller's email is in the SUPERADMIN_EMAILS env var allowlist
//
// Belt-and-suspenders: a DB-write attacker who flips is_superadmin still
// can't hit the routes without controlling an allow-listed email; an
// allow-listed email without the DB flag also fails — so revoking access
// is a single SQL update with no redeploy needed.
//
// Returns the userId on success; otherwise an HTTP-shaped error envelope
// suitable for `return NextResponse.json(...)` in the calling route.

export type SuperadminGate =
  | { ok: true;  userId: string; email: string }
  | { ok: false; status: number; message: string }

export async function requireSuperadmin(authHeader: string | null): Promise<SuperadminGate> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Missing bearer token' }
  }
  const token = authHeader.slice('Bearer '.length)

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { ok: false, status: 500, message: 'Supabase env not configured' }
  }

  // Verify the JWT against Supabase auth (anon client; we just need the
  // token-to-user resolution, not RLS-bypass).
  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user || !user.email) {
    return { ok: false, status: 401, message: 'Invalid session' }
  }

  // Gate 1: env allowlist. Comma-separated list, case-insensitive compare.
  const rawAllowlist = process.env.SUPERADMIN_EMAILS ?? ''
  const allowlist = rawAllowlist
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  if (!allowlist.includes(user.email.toLowerCase())) {
    // Diagnostic-only: log the reject reason so a 403 in production
    // tells us which gate is actually failing. We log the lengths +
    // presence flags (not the env value itself) to avoid leaking
    // secrets to log aggregators.
    console.warn('[superadmin-gate] env-allowlist reject', {
      email:              user.email,
      allowlist_count:    allowlist.length,
      env_var_set:        rawAllowlist.length > 0,
      env_var_raw_length: rawAllowlist.length,
    })
    return { ok: false, status: 403, message: 'Superadmin only' }
  }

  // Gate 2: DB flag. Read via service-role client so we don't depend on RLS.
  const admin = supabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_superadmin) {
    console.warn('[superadmin-gate] db-flag reject', {
      email:           user.email,
      user_id:         user.id,
      profile_found:   profile !== null,
      is_superadmin:   profile?.is_superadmin ?? null,
    })
    return { ok: false, status: 403, message: 'Superadmin only' }
  }

  return { ok: true, userId: user.id, email: user.email }
}
