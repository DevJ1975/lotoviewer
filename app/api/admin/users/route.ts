import { NextResponse } from 'next/server'
import { supabaseAdmin, generateTempPassword } from '@/lib/supabaseAdmin'
import { createClient } from '@supabase/supabase-js'

// Verify the caller's JWT and confirm they're an admin before doing anything.
// The JWT comes from the browser's supabase client in an Authorization header.
async function requireAdmin(authHeader: string | null): Promise<{ ok: true; userId: string } | { ok: false; status: number; message: string }> {
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, status: 401, message: 'Missing bearer token' }
  const token = authHeader.slice('Bearer '.length)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, message: 'Invalid session' }

  const admin = supabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_admin) return { ok: false, status: 403, message: 'Admin only' }

  return { ok: true, userId: user.id }
}

// POST /api/admin/users  { email, fullName? }
// Creates an auth user with a random temp password and an accompanying
// profiles row. Returns { email, tempPassword, fullName } so the admin UI
// can render the copy-paste invitation email.
export async function POST(req: Request) {
  const gate = await requireAdmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { email?: unknown; fullName?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  const admin    = supabaseAdmin()
  const tempPw   = generateTempPassword()

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPw,
    email_confirm: true,   // skip the Supabase-managed confirmation email
    user_metadata: fullName ? { full_name: fullName } : undefined,
  })
  if (createErr || !created.user) {
    return NextResponse.json({ error: createErr?.message ?? 'Could not create user' }, { status: 400 })
  }

  // handle_new_user() trigger already inserted the profiles row; patch it
  // with the supplied name and make sure must_change_password is true.
  const { error: profErr } = await admin
    .from('profiles')
    .update({
      full_name: fullName || null,
      must_change_password: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', created.user.id)
  if (profErr) {
    // Best-effort rollback so we don't leave a half-created user behind.
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: profErr.message }, { status: 400 })
  }

  return NextResponse.json({ email, fullName, tempPassword: tempPw })
}

// GET /api/admin/users — list profiles for the admin screen.
export async function GET(req: Request) {
  const gate = await requireAdmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, full_name, is_admin, must_change_password, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data ?? [] })
}

// DELETE /api/admin/users?id=<uuid> — remove a user (auth + profile via cascade).
export async function DELETE(req: Request) {
  const gate = await requireAdmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (id === gate.userId) return NextResponse.json({ error: 'Cannot remove your own account' }, { status: 400 })

  const admin = supabaseAdmin()
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
