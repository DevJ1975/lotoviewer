import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import {
  createDirectUpload,
  getCloudflareStreamConfig,
  getVideoStatus,
} from '@/lib/strike/cloudflareStream'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidStrikeStorageVideoPath } from '@soteria/core/strikeMedia'

export const runtime = 'nodejs'

// Cloudflare Stream upload handshake for STRIKE Studio.
//
//   POST  registers an upload: stamps the Supabase master-archive path on
//         the version (the original stays in our bucket — that file is the
//         tenant's IP), asks Stream for a one-time direct-upload URL, and
//         parks the pending UID in video_meta. The browser uploads the file
//         straight to Cloudflare; Vercel's request-body limit never sees it.
//   GET   polls transcode status. Only when Stream reports ready do the
//         provider columns flip to 'cloudflare', so a half-finished upload
//         can never leave a published version pointing at a dead video.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_VIDEO_DURATION_SECONDS = 60 * 60

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const config = getCloudflareStreamConfig()
  if (!config) {
    return NextResponse.json({ error: 'Cloudflare Stream is not configured.' }, { status: 503 })
  }

  let body: { module_version_id?: unknown; archive_path?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const versionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(versionId)) {
    return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })
  }
  const archivePath = typeof body.archive_path === 'string' ? body.archive_path.trim() : ''
  if (archivePath && !isValidStrikeStorageVideoPath(archivePath)) {
    return NextResponse.json({ error: 'Archive path must be a valid strike-media storage path' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: version, error: versionErr } = await admin
      .from('strike_module_versions')
      .select('id, module_id, video_meta')
      .eq('id', versionId)
      .maybeSingle()
    if (versionErr) throw new Error(versionErr.message)
    if (!version) return NextResponse.json({ error: 'Module version not found' }, { status: 404 })

    const upload = await createDirectUpload(config, {
      maxDurationSeconds: MAX_VIDEO_DURATION_SECONDS,
      meta: { module_version_id: versionId },
    })

    const { error: updateErr } = await admin
      .from('strike_module_versions')
      .update({
        ...(archivePath ? { video_path: archivePath } : {}),
        video_meta: {
          ...(version.video_meta as Record<string, unknown> ?? {}),
          pending_stream_uid: upload.uid,
        },
      })
      .eq('id', versionId)
    if (updateErr) throw new Error(updateErr.message)

    return NextResponse.json({ upload_url: upload.uploadURL, uid: upload.uid }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin/strike/upload' } })
    return NextResponse.json({ error: 'Could not start the video upload.' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const config = getCloudflareStreamConfig()
  if (!config) {
    return NextResponse.json({ error: 'Cloudflare Stream is not configured.' }, { status: 503 })
  }

  const versionId = new URL(req.url).searchParams.get('module_version_id') ?? ''
  if (!UUID_RE.test(versionId)) {
    return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: version, error: versionErr } = await admin
      .from('strike_module_versions')
      .select('id, video_provider, video_external_id, video_ready, video_meta, duration_seconds')
      .eq('id', versionId)
      .maybeSingle()
    if (versionErr) throw new Error(versionErr.message)
    if (!version) return NextResponse.json({ error: 'Module version not found' }, { status: 404 })

    const meta = (version.video_meta as Record<string, unknown> | null) ?? {}
    const pendingUid = typeof meta.pending_stream_uid === 'string' ? meta.pending_stream_uid : null
    const uid = pendingUid ?? (version.video_provider === 'cloudflare' ? version.video_external_id : null)
    if (!uid) return NextResponse.json({ error: 'No Stream upload is registered for this version' }, { status: 404 })

    const status = await getVideoStatus(config, uid)
    if (status.ready && pendingUid) {
      const restMeta = { ...meta }
      delete restMeta.pending_stream_uid
      const { error: updateErr } = await admin
        .from('strike_module_versions')
        .update({
          video_provider: 'cloudflare',
          video_external_id: uid,
          video_ready: true,
          video_meta: { ...restMeta, stream_state: status.state, stream_size: status.size },
          ...(status.durationSeconds ? { duration_seconds: status.durationSeconds } : {}),
        })
        .eq('id', versionId)
      if (updateErr) throw new Error(updateErr.message)
    }

    return NextResponse.json({
      uid,
      ready: status.ready,
      state: status.state,
      duration_seconds: status.durationSeconds,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin/strike/upload' } })
    return NextResponse.json({ error: 'Could not check the video status.' }, { status: 500 })
  }
}
