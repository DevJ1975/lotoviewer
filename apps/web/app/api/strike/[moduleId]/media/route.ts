import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { loadPublishedStrikeVersion } from '@/lib/strike/moduleAccess'
import {
  getCloudflareStreamConfig,
  hlsUrl,
  signPlaybackToken,
} from '@/lib/strike/cloudflareStream'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { resolveStrikeVideo } from '@soteria/core/strikeMedia'

export const runtime = 'nodejs'

// Playback URLs are short-lived on purpose: long enough to start and
// buffer, short enough that a pasted link goes stale before it spreads.
// The player silently re-requests when a URL expires mid-session.
const PLAYBACK_TTL_SECONDS = 600

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface MediaBody {
  module_version_id?: unknown
}

interface RouteContext {
  params: Promise<{ moduleId: string }>
}

export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  if (!UUID_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid module id' }, { status: 400 })

  const limit = checkMemoryRateLimit(`strike-media:${gate.tenantId}:${gate.userId}`, 20, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many playback requests. Try again in a minute.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec ?? 60) } },
    )
  }

  let body: MediaBody
  try { body = await req.json() as MediaBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const moduleVersionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(moduleVersionId)) {
    return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const lookup = await loadPublishedStrikeVersion(admin, {
      moduleId,
      moduleVersionId,
      tenantId: gate.tenantId,
      role: gate.role,
    })
    if (!lookup.ok) return NextResponse.json({ error: lookup.message }, { status: lookup.status })
    const { version } = lookup

    const captionsUrl = await signStorageUrl(admin, version.captions_path, PLAYBACK_TTL_SECONDS)

    const source = resolveStrikeVideo(version)
    if (source.kind === 'none') {
      return NextResponse.json({ provider: null, url: null, captions_url: captionsUrl })
    }
    if (source.kind === 'unsupported') {
      return NextResponse.json({ error: source.reason }, { status: 422 })
    }

    if (source.kind === 'stream') {
      const config = getCloudflareStreamConfig()
      if (!config) {
        return NextResponse.json(
          { error: 'Streaming delivery is not configured. Contact your administrator.' },
          { status: 503 },
        )
      }
      const { token, expiresAt } = signPlaybackToken(config, source.videoId, PLAYBACK_TTL_SECONDS)
      await recordAccess(admin, gate, moduleId, version.id, 'cloudflare', source.videoId)
      return NextResponse.json({
        provider: 'cloudflare',
        url: hlsUrl(config, token),
        expires_at: expiresAt,
        captions_url: captionsUrl,
      })
    }

    const url = await signStorageUrl(admin, source.path, PLAYBACK_TTL_SECONDS)
    if (!url) return NextResponse.json({ error: 'Video file is unavailable.' }, { status: 404 })
    await recordAccess(admin, gate, moduleId, version.id, 'storage', source.path)
    return NextResponse.json({
      provider: 'storage',
      url,
      expires_at: new Date(Date.now() + PLAYBACK_TTL_SECONDS * 1000).toISOString(),
      captions_url: captionsUrl,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/media' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

async function signStorageUrl(
  admin: ReturnType<typeof supabaseAdmin>,
  path: string | null,
  ttlSeconds: number,
): Promise<string | null> {
  if (!path) return null
  const { data } = await admin.storage.from('strike-media').createSignedUrl(path, ttlSeconds)
  return data?.signedUrl ?? null
}

// Best-effort audit trail: a logging hiccup must never block training.
async function recordAccess(
  admin: ReturnType<typeof supabaseAdmin>,
  gate: { tenantId: string; userId: string },
  moduleId: string,
  moduleVersionId: string,
  provider: 'storage' | 'cloudflare',
  objectRef: string,
): Promise<void> {
  const { error } = await admin.from('strike_media_access').insert({
    tenant_id: gate.tenantId,
    user_id: gate.userId,
    module_id: moduleId,
    module_version_id: moduleVersionId,
    provider,
    media_kind: 'video',
    object_ref: objectRef,
    token_ttl_seconds: PLAYBACK_TTL_SECONDS,
    client_context: { mode: 'learner_player' },
  })
  if (error) {
    Sentry.captureMessage(`strike_media_access insert failed: ${error.message}`, {
      tags: { route: 'strike/media' },
    })
  }
}
