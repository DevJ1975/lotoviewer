import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { copyFromUrl, getCloudflareStreamConfig } from '@/lib/strike/cloudflareStream'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { resolveStrikeVideoSource } from '@soteria/core/strikeMedia'

export const runtime = 'nodejs'

// One-click migration of a legacy Supabase-storage video to Cloudflare
// Stream: Stream pulls the file from a short-lived signed URL, the pending
// UID parks in video_meta, and the upload route's GET poll flips the
// provider columns once transcoding finishes. The original file stays in
// strike-media as the master archive — migration copies, never moves.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COPY_SOURCE_TTL_SECONDS = 60 * 60

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const config = getCloudflareStreamConfig()
  if (!config) {
    return NextResponse.json({ error: 'Cloudflare Stream is not configured.' }, { status: 503 })
  }

  let body: { module_version_id?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const versionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(versionId)) {
    return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: version, error: versionErr } = await admin
      .from('strike_module_versions')
      .select('id, video_provider, video_path, video_meta')
      .eq('id', versionId)
      .maybeSingle()
    if (versionErr) throw new Error(versionErr.message)
    if (!version) return NextResponse.json({ error: 'Module version not found' }, { status: 404 })
    if (version.video_provider === 'cloudflare') {
      return NextResponse.json({ error: 'This version already streams from Cloudflare.' }, { status: 409 })
    }

    const source = resolveStrikeVideoSource(version.video_path)
    if (source.kind !== 'storage') {
      return NextResponse.json({ error: 'This version has no storage video to migrate.' }, { status: 422 })
    }

    const { data: signed, error: signErr } = await admin.storage
      .from('strike-media')
      .createSignedUrl(source.path, COPY_SOURCE_TTL_SECONDS)
    if (signErr || !signed?.signedUrl) {
      throw new Error(signErr?.message ?? 'Could not sign the source video URL')
    }

    const { uid } = await copyFromUrl(config, {
      url: signed.signedUrl,
      meta: { module_version_id: versionId },
    })

    const { error: updateErr } = await admin
      .from('strike_module_versions')
      .update({
        video_meta: {
          ...(version.video_meta as Record<string, unknown> ?? {}),
          pending_stream_uid: uid,
        },
      })
      .eq('id', versionId)
    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json({ uid }, { status: 202 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin/strike/migrate-video' } })
    return NextResponse.json({ error: 'Could not start the video migration.' }, { status: 500 })
  }
}
