import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { releaseNoteCutoffIso, RELEASE_NOTE_BANNER_DAYS } from '@soteria/core/releaseNotes'

// GET /api/release-notes/latest
//
// Returns the most recently published release note IF it is still inside the
// banner window (RELEASE_NOTE_BANNER_DAYS from its published_at), else
// { note: null }. Consumed by the in-app banner on every authenticated
// user's page-load.
//
// The age cutoff is applied HERE, in SQL, rather than left to the client.
// The banner's other exit — the user dismissing it — is a localStorage
// stamp, which is per-device and clearable; the age rule is the one that has
// to hold for everyone, so it belongs on the server. A client that ignores
// or loses its stamp still cannot resurrect a month-old announcement.
//
// Note this endpoint is the BANNER's feed, not the changelog: /whats-new
// reads /api/release-notes, which is unfiltered, so ageing a note out of the
// banner never hides it from the history page.
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
    .gte('published_at', releaseNoteCutoffIso(Date.now()))
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // windowDays travels with the payload so the client can re-check the
  // boundary on a long-lived tab without hardcoding the number twice.
  return NextResponse.json({
    note: data as LatestReleaseNote | null,
    windowDays: RELEASE_NOTE_BANNER_DAYS,
  })
}
