import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { buildInspectorUrl, type InspectorTokenPayload } from '@/lib/inspectorToken'

// POST /api/inspector/sign
// Admin-only. Mints a signed inspector URL from a date range + label +
// optional expiry-in-days (defaults to 30). The URL is the only auth
// for the inspector view; the secret never leaves the server.
//
// Body shape:
//   { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', label: string, expiresInDays?: number }
// Response shape:
//   { url: string, exp: number /* unix sec */ }

interface Body {
  start?:          string
  end?:            string
  label?:          string
  expiresInDays?:  number
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

const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 90      // Cap so a leak doesn't grant year-long access
const MIN_DAYS = 1

export async function POST(req: Request) {
  const adminId = await requireAdmin(req.headers.get('authorization'))
  if (!adminId) return NextResponse.json({ error: 'Admins only' }, { status: 401 })

  const secret = process.env.INSPECTOR_TOKEN_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'INSPECTOR_TOKEN_SECRET is not configured. Set it in env (a long random string) before issuing tokens.' },
      { status: 503 },
    )
  }

  let body: Body
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const start = body.start?.trim()
  const end   = body.end?.trim()
  const label = body.label?.trim()
  if (!start || !DATE_RE.test(start)) return NextResponse.json({ error: 'start must be YYYY-MM-DD' }, { status: 400 })
  if (!end   || !DATE_RE.test(end))   return NextResponse.json({ error: 'end must be YYYY-MM-DD' }, { status: 400 })
  if (start > end) return NextResponse.json({ error: 'start must be on or before end' }, { status: 400 })
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })
  if (label.length > 200) return NextResponse.json({ error: 'label is too long (max 200 chars)' }, { status: 400 })

  const expiresInDays = Number.isFinite(body.expiresInDays)
    ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.floor(body.expiresInDays as number)))
    : 30
  const exp = Math.floor(Date.now() / 1000) + expiresInDays * 24 * 60 * 60

  // Build the URL using the request's origin so it works behind any
  // canonical domain. Falls back to NEXT_PUBLIC_APP_URL if the
  // x-forwarded-host header isn't set (e.g. local dev).
  let origin: string
  try {
    origin = new URL(req.url).origin
  } catch {
    origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000'
  }

  const payload: InspectorTokenPayload = { start, end, label, exp }
  try {
    const url = buildInspectorUrl({ origin, payload, secret })
    return NextResponse.json({ url, exp })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/inspector/sign' } })
    console.error('[inspector/sign]', err)
    return NextResponse.json({ error: 'Could not sign token' }, { status: 500 })
  }
}
