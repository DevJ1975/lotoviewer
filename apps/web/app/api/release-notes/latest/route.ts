import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// GET /api/release-notes/latest
//
// Returns the most recently published release note, or { note: null }
// if no published notes exist. Consumed by the in-app banner on every
// authenticated user's first page-load.
//
// Auth: any signed-in user (not superadmin-only). The release_notes
// RLS policy already gates: published_at IS NOT NULL is readable by
// authenticated. We do the JWT check here to enforce "must be
// signed in" without leaking notes to anonymous callers.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface LatestReleaseNote {
  id:           number
  version:      string
  title:        string
  body_md:      string
  published_at: string
}

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

  // Authenticated client carrying the user's JWT — RLS policy
  // release_notes_published_read gates published rows for any
  // authenticated user. Drafts (published_at IS NULL) are
  // hidden by RLS.
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
    .limit(1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ note: data as LatestReleaseNote | null })
}
