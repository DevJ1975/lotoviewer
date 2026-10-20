import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeMember } from '@/lib/strike/gate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { loadPublishedStrikeVersion } from '@/lib/strike/moduleAccess'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  gradeAndRecordAttempt,
  resolveMemberIdForUser,
  type StrikeAnswerMap,
  type StrikeLearner,
  type WatchProgress,
} from '@/lib/strike/attempts'
import { resolveStrikeVideo } from '@soteria/core/strikeMedia'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SubmitBody {
  module_version_id?: unknown
  assignment_id?: unknown
  attempt_id?: unknown
  answers?: unknown
  watch?: unknown
}

interface RouteContext {
  params: Promise<{ moduleId: string }>
}

export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  if (!UUID_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid module id' }, { status: 400 })

  const limit = checkMemoryRateLimit(`strike-submit:${gate.tenantId}:${gate.userId}`, 10, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many submissions. Try again in a minute.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec ?? 60) } },
    )
  }

  let body: SubmitBody
  try { body = await req.json() as SubmitBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const moduleVersionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(moduleVersionId)) return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })

  const assignmentId = typeof body.assignment_id === 'string' && UUID_RE.test(body.assignment_id)
    ? body.assignment_id
    : null
  const attemptId = typeof body.attempt_id === 'string' && UUID_RE.test(body.attempt_id)
    ? body.attempt_id
    : null
  const answersByQuestionId = isAnswerMap(body.answers) ? body.answers : {}
  const watch = parseWatchProgress(body.watch)

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

    const watchGate = await checkWatchRequirement(admin, gate.tenantId, version, watch)
    if (!watchGate.ok) return NextResponse.json({ error: watchGate.message }, { status: 422 })

    const learner: StrikeLearner = {
      tenantId: gate.tenantId,
      userId: gate.userId,
      memberId: await resolveMemberIdForUser(admin, gate.tenantId, gate.userId),
      role: gate.role,
      channel: 'account',
    }
    const result = await gradeAndRecordAttempt(admin, learner, {
      moduleId,
      version,
      attemptId,
      assignmentId,
      answers: answersByQuestionId,
      watch,
    })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })

    const { attemptId: recordedAttemptId, ...score } = result.value
    return NextResponse.json(
      { attempt_id: recordedAttemptId, ...score },
      { status: 201 },
    )
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/submit' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

async function checkWatchRequirement(
  admin: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  version: { video_external_id: string | null; video_meta: Record<string, unknown> | null },
  watch: WatchProgress | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Modules without a playable video have nothing to watch.
  const source = resolveStrikeVideo(version)
  if (source.kind !== 'vimeo') return { ok: true }

  const { data: settings, error } = await admin
    .from('strike_tenant_settings')
    .select('require_watch_percent')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  const required = settings?.require_watch_percent
  if (typeof required !== 'number' || required <= 0) return { ok: true }

  if (!watch || watch.percent_watched < required) {
    return { ok: false, message: `Watch at least ${required}% of the video before submitting the quiz.` }
  }
  return { ok: true }
}

function parseWatchProgress(value: unknown): WatchProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const percent = toFiniteNumber(record.percent_watched)
  if (percent === null) return null
  return {
    percent_watched: Math.min(100, Math.max(0, Math.round(percent))),
    max_position_seconds: clampNonNegative(toFiniteNumber(record.max_position_seconds)),
    duration_seconds: clampNonNegative(toFiniteNumber(record.duration_seconds)),
  }
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampNonNegative(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.round(value))
}

function isAnswerMap(value: unknown): value is StrikeAnswerMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(v =>
    typeof v === 'string'
    || typeof v === 'boolean'
    || (Array.isArray(v) && v.every(item => typeof item === 'string')),
  )
}
