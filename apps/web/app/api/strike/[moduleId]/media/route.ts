import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { loadPublishedStrikeVersion } from '@/lib/strike/moduleAccess'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { resolveStrikeVideo, vimeoEmbedUrl } from '@soteria/core/strikeMedia'

export const runtime = 'nodejs'

// STRIKE plays Vimeo videos. A Vimeo embed URL isn't itself a secret, but every
// view still routes through this authenticated, rate-limited endpoint so that
// (a) only entitled learners get the link, and (b) strike_media_access keeps a
// who-watched-what audit trail. There's no signed/expiring URL to mint, so the
// response carries expires_at: null. The audit TTL below is a nominal value for
// the (NOT NULL, > 0) column — Vimeo issuance has no real token lifetime.
const AUDIT_TTL_SECONDS = 600

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

    const source = resolveStrikeVideo(version)
    if (source.kind === 'none') {
      return NextResponse.json({ provider: null, url: null })
    }
    if (source.kind === 'unsupported') {
      return NextResponse.json({ error: source.reason }, { status: 422 })
    }

    await recordAccess(admin, gate, moduleId, version.id, source.videoId)
    return NextResponse.json({
      provider: 'vimeo',
      url: vimeoEmbedUrl(source.videoId, source.hash),
      expires_at: null,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/media' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

// Best-effort audit trail: a logging hiccup must never block training.
async function recordAccess(
  admin: ReturnType<typeof supabaseAdmin>,
  gate: { tenantId: string; userId: string },
  moduleId: string,
  moduleVersionId: string,
  objectRef: string,
): Promise<void> {
  const { error } = await admin.from('strike_media_access').insert({
    tenant_id: gate.tenantId,
    user_id: gate.userId,
    module_id: moduleId,
    module_version_id: moduleVersionId,
    provider: 'vimeo',
    media_kind: 'video',
    object_ref: objectRef,
    token_ttl_seconds: AUDIT_TTL_SECONDS,
    client_context: { mode: 'learner_player' },
  })
  if (error) {
    Sentry.captureMessage(`strike_media_access insert failed: ${error.message}`, {
      tags: { route: 'strike/media' },
    })
  }
}
