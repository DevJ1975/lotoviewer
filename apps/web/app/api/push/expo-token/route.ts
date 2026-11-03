import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isExpoPushToken } from '@/lib/notifications/expoPush'

// POST   /api/push/expo-token  — register the signed-in user's Expo push token
// DELETE /api/push/expo-token  — remove it (sign-out)
//
// The mobile counterpart of /api/push/subscribe. Idempotent: the same token
// upserts. Moving a token to another account (shared device) rewrites its
// owner, so a phone never keeps notifying the previous user.
//
// Auth matches /api/push/subscribe: bearer token validated with the anon
// client, then writes through the admin client so the upsert can cross the
// user-scoped RLS on expo_push_tokens.

const PLATFORMS = new Set(['ios', 'android'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as Record<string, unknown> : null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const userId = await authedUserId(req.headers.get('authorization'))
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const token    = typeof body.token === 'string' ? body.token : ''
  const platform = typeof body.platform === 'string' ? body.platform : ''
  if (!isExpoPushToken(token)) {
    return NextResponse.json({ error: 'token must be an Expo push token' }, { status: 400 })
  }
  if (!PLATFORMS.has(platform)) {
    return NextResponse.json({ error: 'platform must be ios or android' }, { status: 400 })
  }

  // The tenant is informational (which workspace the device last used); a
  // malformed value is dropped rather than rejected so it never blocks sign-in.
  const rawTenant = req.headers.get('x-active-tenant')?.trim() ?? ''
  const tenantId  = UUID_RE.test(rawTenant) ? rawTenant : null

  const { error } = await supabaseAdmin()
    .from('expo_push_tokens')
    .upsert(
      {
        profile_id:   userId,
        tenant_id:    tenantId,
        token,
        platform,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 200 })
}

export async function DELETE(req: Request) {
  const userId = await authedUserId(req.headers.get('authorization'))
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await readJson(req)
  const token = body && typeof body.token === 'string' ? body.token : ''
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  // Scoped by profile_id so a user can only remove their own device.
  const { error } = await supabaseAdmin()
    .from('expo_push_tokens')
    .delete()
    .eq('profile_id', userId)
    .eq('token', token)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 200 })
}
