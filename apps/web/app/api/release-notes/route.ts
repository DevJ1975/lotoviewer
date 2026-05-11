import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { LatestReleaseNote } from './latest/route'

// GET /api/release-notes
//
// Lists every PUBLISHED release note, newest first. Consumed by the
// public /whats-new page so users have a place to scroll back through
// changes. Drafts are hidden by RLS (published_at IS NULL is gated to
// superadmins by release_notes_superadmin_all).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HARD_LIMIT = 100

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 })
  }

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 })
  }

  const client = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth:   { persistSession: false },
  })

  const { data: { user } } = await client.auth.getUser(auth.slice('Bearer '.length))
  if (!user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

  const { data, error } = await client
    .from('release_notes')
    .select('id, version, title, body_md, published_at')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(HARD_LIMIT)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ notes: (data ?? []) as LatestReleaseNote[] })
}
