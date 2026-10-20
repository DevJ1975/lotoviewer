import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeMember } from '@/lib/strike/gate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { loadPublishedStrikeVersion } from '@/lib/strike/moduleAccess'
import { parseBlockEvents, recordBlockEvents, resolveMemberIdForUser } from '@/lib/strike/attempts'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ moduleId: string }>
}

export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  if (!UUID_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid module id' }, { status: 400 })

  const limit = checkMemoryRateLimit(`strike-events:${gate.tenantId}:${gate.userId}`, 120, 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  let body: { module_version_id?: unknown; attempt_id?: unknown; events?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const moduleVersionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  const attemptId = typeof body.attempt_id === 'string' ? body.attempt_id : ''
  if (!UUID_RE.test(moduleVersionId) || !UUID_RE.test(attemptId)) {
    return NextResponse.json({ error: 'Invalid module version or attempt id' }, { status: 400 })
  }
  const events = parseBlockEvents(body.events)
  if (!events) return NextResponse.json({ error: 'Send 1–50 well-formed block events.' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const lookup = await loadPublishedStrikeVersion(admin, { moduleId, moduleVersionId, tenantId: gate.tenantId, role: gate.role })
    if (!lookup.ok) return NextResponse.json({ error: lookup.message }, { status: lookup.status })

    const result = await recordBlockEvents(admin, {
      tenantId: gate.tenantId,
      userId: gate.userId,
      memberId: await resolveMemberIdForUser(admin, gate.tenantId, gate.userId),
      role: gate.role,
      channel: 'account',
    }, { moduleId, version: lookup.version, attemptId, events })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
    return NextResponse.json(result.value)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/events' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
