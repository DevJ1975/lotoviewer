import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/users/me/digest-preferences
//   Returns { preferences: [{ tenant_id, cadence, last_sent_at }] }
// PUT /api/users/me/digest-preferences
//   Body: { tenant_id, cadence: 'off'|'daily'|'weekly' }
//   Idempotent upsert.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CADENCES = ['off','daily','weekly'] as const

interface AuthOk { ok: true; userId: string; email: string }
interface AuthErr { ok: false; status: number; message: string }

async function requireUser(req: Request): Promise<AuthOk | AuthErr> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, status: 401, message: 'Missing bearer token' }
  const token = authHeader.slice('Bearer '.length)
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return { ok: false, status: 500, message: 'Supabase env not configured' }
  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user || !user.email) return { ok: false, status: 401, message: 'Invalid session' }
  return { ok: true, userId: user.id, email: user.email }
}

export async function GET(req: Request) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('user_digest_preferences')
      .select('tenant_id, cadence, last_sent_at')
      .eq('user_id', auth.userId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ preferences: data ?? [] })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'digest-prefs/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  let body: { tenant_id?: string; cadence?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const tenantId = (body.tenant_id ?? '').trim()
  const cadence  = (body.cadence ?? '').trim()
  if (!UUID_RE.test(tenantId)) return NextResponse.json({ error: 'tenant_id must be uuid' }, { status: 400 })
  if (!(CADENCES as readonly string[]).includes(cadence)) return NextResponse.json({ error: 'cadence must be off|daily|weekly' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    // Verify the caller is a member of that tenant before saving a
    // preference for it.
    const { data: mem } = await admin
      .from('tenant_memberships')
      .select('tenant_id')
      .eq('user_id', auth.userId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!mem) return NextResponse.json({ error: 'Not a member of this tenant.' }, { status: 403 })

    const { error } = await admin
      .from('user_digest_preferences')
      .upsert({
        user_id:   auth.userId,
        tenant_id: tenantId,
        cadence,
        email:     auth.email,
      }, { onConflict: 'user_id,tenant_id' })
    if (error) {
      Sentry.captureException(error, { tags: { route: 'digest-prefs/PUT' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'digest-prefs/PUT' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
