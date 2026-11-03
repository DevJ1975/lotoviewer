import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { PushPayload } from '@/lib/push'
import { sendExpoPush } from '@/lib/notifications/expoPush'

// POST /api/push/dispatch — fans out a payload to every subscriber in
// loto_push_subscriptions. Body shape:
//   { title, body, url?, tag?, profile_ids?: string[] }
// If profile_ids is omitted, every subscription receives the push.
//
// Two auth paths:
//   1. Bearer token + admin profile  — for human-driven dispatches
//      (the "Send a test push" button on /settings/notifications).
//   2. X-Internal-Secret header     — for machine-driven dispatches
//      (the Postgres trigger from migration 018 calling via pg_net).
//      The secret value must match env INTERNAL_PUSH_SECRET.
//
// VAPID keys come from env:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  (also exposed to the browser)
//   VAPID_PRIVATE_KEY             (server-only)
//   VAPID_SUBJECT                 (mailto: or https:// — required by spec)
// Generate with `npx web-push generate-vapid-keys`.

interface Body extends PushPayload {
  profile_ids?: string[]
}

async function requireAdmin(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  const client = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return null
  const admin = supabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  return profile?.is_admin ? user.id : null
}

function configureVapid(): { ok: true } | { ok: false; reason: string } {
  const pub  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subj = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subj) {
    return { ok: false, reason: 'VAPID keys not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.' }
  }
  webpush.setVapidDetails(subj, pub, priv)
  return { ok: true }
}

// Constant-time string compare for the internal secret. avoids timing
// oracles even though the surface is small — same hygiene we'd want
// for any shared-secret check.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export async function POST(req: Request) {
  // Try internal-secret first — short-circuits the Supabase round-trip
  // when the Postgres trigger fires.
  const provided = req.headers.get('x-internal-secret') ?? ''
  const expected = process.env.INTERNAL_PUSH_SECRET ?? ''
  const internalOk = expected.length > 0 && provided.length > 0 && safeEqual(provided, expected)

  if (!internalOk) {
    const adminId = await requireAdmin(req.headers.get('authorization'))
    if (!adminId) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.title || !body.body) {
    return NextResponse.json({ error: 'Missing title or body' }, { status: 400 })
  }

  // Phones are reached through Expo regardless of VAPID configuration.
  const expoResult = await sendExpoPush({
    payload:    { title: body.title, body: body.body, url: body.url, tag: body.tag },
    profileIds: body.profile_ids && body.profile_ids.length > 0 ? body.profile_ids : undefined,
    source:     'push-dispatch',
  })

  const vapid = configureVapid()
  if (!vapid.ok) {
    if (expoResult.sent > 0) {
      return NextResponse.json({ sent: expoResult.sent, failed: expoResult.failed, pruned: expoResult.pruned }, { status: 200 })
    }
    return NextResponse.json({ error: vapid.reason }, { status: 500 })
  }

  const admin = supabaseAdmin()
  let q = admin
    .from('loto_push_subscriptions')
    .select('id, endpoint, p256dh, auth, profile_id')
  if (body.profile_ids && body.profile_ids.length > 0) {
    q = q.in('profile_id', body.profile_ids)
  }
  const { data: subs, error } = await q
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!subs || subs.length === 0) {
    return NextResponse.json({
      sent: expoResult.sent, failed: expoResult.failed, pruned: expoResult.pruned,
      ...(expoResult.sent === 0 ? { message: 'No subscriptions found.' } : {}),
    }, { status: 200 })
  }

  // Compose the JSON payload the SW will read. Trim to known fields so a
  // future caller can't smuggle extra keys into the notification.
  const payload: PushPayload = {
    title: body.title,
    body:  body.body,
    url:   body.url,
    tag:   body.tag,
  }
  const json = JSON.stringify(payload)

  // Fan out in parallel; collect endpoints that 404/410 so we can prune
  // them. Web Push services return Gone/NotFound when the user has
  // uninstalled the PWA or revoked permission — those rows should be
  // deleted, not retried.
  const stale: string[] = []
  const results = await Promise.allSettled(
    subs.map(s => webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      json,
    ).catch((err: { statusCode?: number; endpoint?: string }) => {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        stale.push(s.endpoint)
      }
      throw err
    })),
  )

  const webSent = results.filter(r => r.status === 'fulfilled').length
  const sent    = webSent + expoResult.sent
  const failed  = (results.length - webSent) + expoResult.failed

  if (stale.length > 0) {
    // Best-effort prune of dead subscriptions. Failure here doesn't
    // affect the dispatch result — the next dispatch will try them
    // again and re-prune.
    await admin.from('loto_push_subscriptions').delete().in('endpoint', stale)
  }

  return NextResponse.json({ sent, failed, pruned: stale.length + expoResult.pruned }, { status: 200 })
}
