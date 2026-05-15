import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  isValidStrikeStorageThumbnailPath,
  isValidStrikeStorageVideoPath,
} from '@soteria/core/strikeMedia'

// PATCH /api/superadmin/strike/[moduleId]/versions/[versionId]
//   Update a version's video pointer, duration, or passing score. The
//   video file itself is uploaded directly from the browser to Supabase
//   Storage (strike-media bucket); this endpoint just records the path
//   and metadata so we never funnel large bodies through the API layer.
//
//   video_path is validated against the same storage-path policy the
//   learner page uses, so a malicious payload can't point the player at
//   another tenant's file or an external URL.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ moduleId: string; versionId: string }> }

export async function PATCH(req: Request, ctx: RouteContext) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId, versionId } = await ctx.params
  if (!UUID_RE.test(moduleId) || !UUID_RE.test(versionId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const admin = supabaseAdmin()
  const { data: version, error: lookupErr } = await admin
    .from('strike_module_versions')
    .select('id, module_id, tenant_id, library_scope, video_path, thumbnail_path')
    .eq('id', versionId)
    .eq('module_id', moduleId)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!version) return NextResponse.json({ error: 'Version not found for module' }, { status: 404 })

  const updates: Record<string, unknown> = {}

  if (body.video_path !== undefined) {
    if (body.video_path === null || body.video_path === '') {
      updates.video_path = null
    } else if (typeof body.video_path !== 'string') {
      return NextResponse.json({ error: 'video_path must be a string or null' }, { status: 400 })
    } else {
      const value = body.video_path.trim()
      if (!isValidStrikeStorageVideoPath(value)) {
        return NextResponse.json({ error: 'video_path must reference the strike-media bucket' }, { status: 400 })
      }
      // The first path segment must match the version's scope so a global
      // version cannot point at tenant content and vice versa.
      const root = value.split('/')[0]
      const expected = version.library_scope === 'global' ? 'global' : version.tenant_id
      if (root !== expected) {
        return NextResponse.json({ error: 'video_path scope does not match version scope' }, { status: 400 })
      }
      updates.video_path = value
    }
  }

  if (body.thumbnail_path !== undefined) {
    if (body.thumbnail_path === null || body.thumbnail_path === '') {
      updates.thumbnail_path = null
    } else if (typeof body.thumbnail_path !== 'string') {
      return NextResponse.json({ error: 'thumbnail_path must be a string or null' }, { status: 400 })
    } else {
      const value = body.thumbnail_path.trim()
      if (!isValidStrikeStorageThumbnailPath(value)) {
        return NextResponse.json({ error: 'thumbnail_path must reference an image in the strike-media bucket' }, { status: 400 })
      }
      const root = value.split('/')[0]
      const expected = version.library_scope === 'global' ? 'global' : version.tenant_id
      if (root !== expected) {
        return NextResponse.json({ error: 'thumbnail_path scope does not match version scope' }, { status: 400 })
      }
      updates.thumbnail_path = value
    }
  }

  if (body.duration_seconds !== undefined) {
    if (body.duration_seconds === null) {
      updates.duration_seconds = null
    } else {
      const n = typeof body.duration_seconds === 'number' ? body.duration_seconds : Number(body.duration_seconds)
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: 'duration_seconds must be > 0' }, { status: 400 })
      }
      updates.duration_seconds = Math.round(n)
    }
  }

  if (body.passing_score !== undefined) {
    const n = typeof body.passing_score === 'number' ? body.passing_score : Number(body.passing_score)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json({ error: 'passing_score must be 0-100' }, { status: 400 })
    }
    updates.passing_score = Math.round(n)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  const { data: updated, error: updErr } = await admin
    .from('strike_module_versions')
    .update(updates)
    .eq('id', versionId)
    .select('id, module_id, version_number, status, video_path, thumbnail_path, duration_seconds, passing_score')
    .single()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ version: updated })
}
