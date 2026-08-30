import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { parseVimeoReference } from '@soteria/core/strikeMedia'

export const runtime = 'nodejs'

// STRIKE video management for a module version. STRIKE plays Vimeo only:
//   POST   attach/replace the Vimeo video (numeric id + optional unlisted hash).
//   DELETE detach the video entirely.
// The id is the source of truth (resolveStrikeVideo keys off video_external_id);
// video_provider/video_ready are written for human readability of the row.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { module_version_id?: unknown; vimeo_url?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const versionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(versionId)) {
    return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })
  }
  const ref = parseVimeoReference(typeof body.vimeo_url === 'string' ? body.vimeo_url : '')
  if (!ref) {
    return NextResponse.json({ error: 'Enter a valid Vimeo link or id.' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: version, error: versionErr } = await admin
      .from('strike_module_versions')
      .select('id, video_meta')
      .eq('id', versionId)
      .maybeSingle()
    if (versionErr) throw new Error(versionErr.message)
    if (!version) return NextResponse.json({ error: 'Module version not found' }, { status: 404 })

    const meta = { ...(version.video_meta as Record<string, unknown> ?? {}) }
    if (ref.hash) meta.vimeo_hash = ref.hash
    else delete meta.vimeo_hash

    const { error: updateErr } = await admin
      .from('strike_module_versions')
      .update({
        video_provider: 'vimeo',
        video_external_id: ref.videoId,
        video_ready: true,
        video_meta: meta,
      })
      .eq('id', versionId)
    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json({ video_id: ref.videoId, hash: ref.hash }, { status: 200 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin/strike/video' } })
    return NextResponse.json({ error: 'Could not save the Vimeo link.' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const versionId = new URL(req.url).searchParams.get('module_version_id') ?? ''
  if (!UUID_RE.test(versionId)) {
    return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: version, error: versionErr } = await admin
      .from('strike_module_versions')
      .select('id, video_meta')
      .eq('id', versionId)
      .maybeSingle()
    if (versionErr) throw new Error(versionErr.message)
    if (!version) return NextResponse.json({ error: 'Module version not found' }, { status: 404 })

    const meta = { ...(version.video_meta as Record<string, unknown> ?? {}) }
    delete meta.vimeo_hash

    const { error: updateErr } = await admin
      .from('strike_module_versions')
      .update({ video_external_id: null, video_ready: false, video_meta: meta })
      .eq('id', versionId)
    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin/strike/video' } })
    return NextResponse.json({ error: 'Could not remove the video.' }, { status: 500 })
  }
}
