import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeMember } from '@/lib/strike/gate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { loadPublishedStrikeVersion } from '@/lib/strike/moduleAccess'
import { versionContent } from '@/lib/strike/attempts'
import { signStrikeContentAssets, STRIKE_ASSET_TTL_SECONDS, STRIKE_MEDIA_BUCKET } from '@/lib/strike/assets'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ moduleId: string }>
}

// Signs the private strike-media objects a block module needs. Audio and
// video are not member-readable in storage (migration 260), so the player
// can only reach them through this entitlement-checked route.
//
// `?download=1` instead returns a link to the rendered MP4, logged to
// strike_media_access like every other video URL issued.
export async function GET(req: Request, ctx: RouteContext) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  const url = new URL(req.url)
  const moduleVersionId = url.searchParams.get('version') ?? ''
  if (!UUID_RE.test(moduleId) || !UUID_RE.test(moduleVersionId)) {
    return NextResponse.json({ error: 'Invalid module or version id' }, { status: 400 })
  }

  const limit = checkMemoryRateLimit(`strike-assets:${gate.tenantId}:${gate.userId}`, 30, 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  try {
    const admin = supabaseAdmin()
    const lookup = await loadPublishedStrikeVersion(admin, { moduleId, moduleVersionId, tenantId: gate.tenantId, role: gate.role })
    if (!lookup.ok) return NextResponse.json({ error: lookup.message }, { status: lookup.status })
    const { version } = lookup

    if (url.searchParams.get('download') === '1') {
      if (!version.download_path) return NextResponse.json({ error: 'No downloadable video for this module.' }, { status: 404 })
      const { data, error } = await admin.storage
        .from(STRIKE_MEDIA_BUCKET)
        .createSignedUrl(version.download_path, STRIKE_ASSET_TTL_SECONDS, { download: true })
      if (error || !data) throw new Error(error?.message ?? 'Could not sign download')
      const { error: logError } = await admin.from('strike_media_access').insert({
        tenant_id: gate.tenantId,
        user_id: gate.userId,
        module_id: moduleId,
        module_version_id: version.id,
        provider: 'storage',
        media_kind: 'video',
        object_ref: version.download_path,
        token_ttl_seconds: STRIKE_ASSET_TTL_SECONDS,
        client_context: { purpose: 'download' },
      })
      if (logError) Sentry.captureMessage(`strike_media_access insert failed: ${logError.message}`, { level: 'warning' })
      return NextResponse.json({ url: data.signedUrl, expires_in: STRIKE_ASSET_TTL_SECONDS })
    }

    const content = versionContent(version)
    if (!content) return NextResponse.json({ urls: {}, expires_in: STRIKE_ASSET_TTL_SECONDS, has_download: false })
    const urls = await signStrikeContentAssets(admin, content)
    return NextResponse.json({ urls, expires_in: STRIKE_ASSET_TTL_SECONDS, has_download: !!version.download_path })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/assets' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
