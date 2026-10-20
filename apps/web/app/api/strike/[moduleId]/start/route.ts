import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeMember } from '@/lib/strike/gate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { loadPublishedStrikeVersion } from '@/lib/strike/moduleAccess'
import { openAttempt, resolveMemberIdForUser } from '@/lib/strike/attempts'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ moduleId: string }>
}

// Opens (or resumes, within 24h) the attempt that block evidence binds to.
// Resuming returns the blocks already reached so the player can restore
// progress on another device, bound to the attempt rather than the browser.
export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  if (!UUID_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid module id' }, { status: 400 })

  const limit = checkMemoryRateLimit(`strike-start:${gate.tenantId}:${gate.userId}`, 20, 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })

  let body: { module_version_id?: unknown; assignment_id?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const moduleVersionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(moduleVersionId)) return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })
  const assignmentId = typeof body.assignment_id === 'string' && UUID_RE.test(body.assignment_id) ? body.assignment_id : null

  try {
    const admin = supabaseAdmin()
    const lookup = await loadPublishedStrikeVersion(admin, { moduleId, moduleVersionId, tenantId: gate.tenantId, role: gate.role })
    if (!lookup.ok) return NextResponse.json({ error: lookup.message }, { status: lookup.status })

    const opened = await openAttempt(admin, {
      tenantId: gate.tenantId,
      userId: gate.userId,
      memberId: await resolveMemberIdForUser(admin, gate.tenantId, gate.userId),
      role: gate.role,
      channel: 'account',
    }, { moduleId, version: lookup.version, assignmentId })

    return NextResponse.json(
      { attempt_id: opened.attemptId, reached: opened.reached, resumed: opened.resumed },
      { status: opened.resumed ? 200 : 201 },
    )
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/start' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
