import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sendAccountDeletionRequestEmail } from '@/lib/email/sendAccountDeletionRequest'

// POST /api/users/me/deletion-request — the signed-in user asks to delete
// their account. Required by App Store guideline 5.1.1(v): deletion must be
// startable from inside the app.
//
// This queues the request rather than deleting the auth user. Incident,
// permit and training records are retained for OSHA recordkeeping and are
// anonymized when support completes the request, as the privacy policy
// describes (app/privacy/page.tsx). Idempotent: a second request while one is
// pending returns the existing one.

const MAX_REASON_CHARS = 1000
const UNIQUE_VIOLATION = '23505'

async function authedUser(authHeader: string | null): Promise<{ id: string; email: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  const client = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user?.email) return null
  return { id: user.id, email: user.email }
}

export async function POST(req: Request) {
  const user = await authedUser(req.headers.get('authorization'))
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let reason: string | null = null
  try {
    const body = await req.json() as { reason?: unknown }
    if (body.reason !== undefined && body.reason !== null) {
      if (typeof body.reason !== 'string') {
        return NextResponse.json({ error: 'reason must be text' }, { status: 400 })
      }
      const trimmed = body.reason.trim()
      if (trimmed.length > MAX_REASON_CHARS) {
        return NextResponse.json({ error: `reason must be ${MAX_REASON_CHARS} characters or fewer` }, { status: 400 })
      }
      reason = trimmed || null
    }
  } catch {
    // An empty body is fine; the reason is optional.
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('account_deletion_requests')
    .insert({ user_id: user.id, email: user.email, reason })
    .select('id, requested_at')
    .single()

  if (error?.code === UNIQUE_VIOLATION) {
    const { data: existing } = await admin
      .from('account_deletion_requests')
      .select('id, requested_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle()
    return NextResponse.json(
      { status: 'pending', alreadyRequested: true, requestedAt: existing?.requested_at ?? null },
      { status: 200 },
    )
  }
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not record the request' }, { status: 500 })
  }

  await sendAccountDeletionRequestEmail({
    userId: user.id, userEmail: user.email, reason, requestedAt: data.requested_at,
  })
  return NextResponse.json({ status: 'pending', alreadyRequested: false, requestedAt: data.requested_at }, { status: 201 })
}
