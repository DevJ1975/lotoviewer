import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/push/subscribe — persist a Web Push subscription handle for
// the currently authenticated user. The client posts the result of
// pushManager.subscribe() here. Idempotent: same endpoint upserts to
// the existing row.
//
// Auth pattern matches /api/admin/users — caller sends Bearer token,
// we validate it via the anon client, then write with the admin client
// (so we can upsert across the user-scoped RLS).

interface Body {
  endpoint:    string
  p256dh:      string
  auth:        string
  user_agent?: string
}

async function authedUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  const client = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return null
  return user.id
}

export async function POST(req: Request) {
  const userId = await authedUserId(req.headers.get('authorization'))
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.endpoint || !body.p256dh || !body.auth) {
    return NextResponse.json({ error: 'Missing endpoint / p256dh / auth' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('loto_push_subscriptions')
    .upsert(
      {
        profile_id:   userId,
        endpoint:     body.endpoint,
        p256dh:       body.p256dh,
        auth:         body.auth,
        user_agent:   body.user_agent ?? null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not save subscription' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id }, { status: 200 })
}

// DELETE /api/push/subscribe  — body: { endpoint }
// Lets the client remove a subscription before/after pushManager.unsubscribe.
export async function DELETE(req: Request) {
  const userId = await authedUserId(req.headers.get('authorization'))
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  let body: { endpoint?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.endpoint) {
    return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
  }
  const admin = supabaseAdmin()
  // Scope by profile_id so a user can only delete their own subscription
  // even though the admin client could write across the table.
  const { error } = await admin
    .from('loto_push_subscriptions')
    .delete()
    .eq('profile_id', userId)
    .eq('endpoint', body.endpoint)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { status: 200 })
}
