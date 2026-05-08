import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { FEATURES, type FeatureDef } from '@soteria/core/features'

// POST /api/superadmin/manuals/bootstrap
//
// Idempotent. Walks the FEATURES registry and inserts a draft stub
// for every top-level feature that doesn't yet have a manuals row.
// Use after shipping a new module to get a placeholder onto the
// /manuals index immediately.
//
// Returns { created: [moduleId, ...], existing: count }.

function isManualCandidate(f: FeatureDef): boolean {
  // Skip child features (their parent's manual covers them).
  if (f.parent) return false
  // Skip internal features that aren't routable on their own.
  if (f.internal) return false
  // Skip "manuals" itself — meta.
  if (f.id === 'manuals') return false
  // We seed every category — admin pages benefit from manuals too.
  return f.enabled
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const candidates = FEATURES.filter(isManualCandidate)
    if (candidates.length === 0) return NextResponse.json({ created: [], existing: 0 })

    const ids = candidates.map(c => c.id)
    const { data: existing, error: existErr } = await admin
      .from('manuals')
      .select('module_id')
      .in('module_id', ids)
    if (existErr) throw new Error(existErr.message)
    const have = new Set(((existing ?? []) as Array<{ module_id: string }>).map(r => r.module_id))
    const missing = candidates.filter(c => !have.has(c.id))

    if (missing.length === 0) {
      return NextResponse.json({ created: [], existing: have.size })
    }

    const rows = missing.map(c => ({
      module_id:    c.id,
      title:        c.name,
      summary:      c.description,
      body_md:      `## Overview\n\nThis manual is a placeholder. **Edit me.**\n\n${c.description}`,
      published_at: null,
      created_by:   gate.userId,
      updated_by:   gate.userId,
    }))
    const { error: insertErr } = await admin.from('manuals').insert(rows)
    if (insertErr) {
      Sentry.captureException(insertErr, { tags: { route: 'manuals-bootstrap/POST' } })
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({
      created:  missing.map(m => m.id),
      existing: have.size,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'manuals-bootstrap/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
