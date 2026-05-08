import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireManualReader } from '@/lib/manuals/auth'

// GET /api/manuals/[moduleId]/versions/[versionId]
//
// Full body of a specific historical version (used by the diff view).
// Permission posture matches the parent: drafts visible only to
// superadmins.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ moduleId: string; versionId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { moduleId, versionId } = await ctx.params
  if (!SLUG_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid moduleId' }, { status: 400 })
  if (!UUID_RE.test(versionId)) return NextResponse.json({ error: 'Invalid versionId' }, { status: 400 })

  const auth = await requireManualReader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  try {
    const admin = supabaseAdmin()
    const { data: m } = await admin
      .from('manuals')
      .select('id, published_at')
      .eq('module_id', moduleId)
      .maybeSingle()
    const manual = m as { id: string; published_at: string | null } | null
    if (!manual) return NextResponse.json({ error: 'Manual not found' }, { status: 404 })
    if (!manual.published_at && !auth.isSuperadmin) {
      return NextResponse.json({ error: 'Manual not found' }, { status: 404 })
    }

    const { data, error } = await admin
      .from('manual_versions')
      .select('id, version, title, summary, body_md, change_note, created_at, created_by')
      .eq('id', versionId)
      .eq('manual_id', manual.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    return NextResponse.json({ version: data })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'manuals/[id]/versions/[v]/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
