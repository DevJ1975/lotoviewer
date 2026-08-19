import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeMember } from '@/lib/strike/gate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { loadPublishedStrikeVersion } from '@/lib/strike/moduleAccess'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  isStrikeAssignmentApplicable,
  scoreStrikeQuiz,
  type StrikeAssignmentTargetType,
  type StrikeQuestionType,
} from '@soteria/core/strike'
import { resolveStrikeVideo } from '@soteria/core/strikeMedia'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SubmitBody {
  module_version_id?: unknown
  assignment_id?: unknown
  answers?: unknown
  watch?: unknown
}

// Self-reported playback progress from the learner's player. Recorded as
// evidence and enforced against the tenant's require_watch_percent knob;
// it is client-claimed, so it deters skipping rather than proving viewing.
interface WatchProgress {
  percent_watched: number
  max_position_seconds: number | null
  duration_seconds: number | null
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

    if (version.retake_limit != null) {
      const { count, error: attemptCountErr } = await admin
        .from('strike_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', gate.userId)
        .eq('module_version_id', moduleVersionId)
        .not('submitted_at', 'is', null)
      if (attemptCountErr) throw new Error(attemptCountErr.message)
      // Count-then-insert race accepted: this is a pacing limit, not a
      // security boundary, and concurrent submits from one learner are rare.
      if ((count ?? 0) >= version.retake_limit) {
        return NextResponse.json(
          { error: 'Retake limit reached for this module version.' },
          { status: 409 },
        )
      }
    }

    const watchGate = await checkWatchRequirement(admin, gate.tenantId, version, watch)
    if (!watchGate.ok) return NextResponse.json({ error: watchGate.message }, { status: 422 })

    if (assignmentId) {
      const { data: assignment, error: assignmentErr } = await admin
        .from('strike_assignments')
        .select('id,tenant_id,module_id,module_version_id,target_type,target_id,status')
        .eq('id', assignmentId)
        .maybeSingle()
      if (assignmentErr) throw new Error(assignmentErr.message)
      if (
        !assignment
        || assignment.tenant_id !== gate.tenantId
        || assignment.module_id !== moduleId
        || assignment.status !== 'active'
        || (assignment.module_version_id && assignment.module_version_id !== moduleVersionId)
      ) {
        return NextResponse.json({ error: 'Assignment does not match this module.' }, { status: 400 })
      }

      if (
        !isStrikeAssignmentApplicable({
          targetType: assignment.target_type as StrikeAssignmentTargetType,
          targetId: assignment.target_id as string | null,
          userId: gate.userId,
          role: gate.role,
        })
      ) {
        return NextResponse.json({ error: 'Assignment is not assigned to this user.' }, { status: 403 })
      }
    }

    const { data: questions, error: questionErr } = await admin
      .from('strike_quiz_questions')
      .select('id,question_type,required,points,explanation')
      .eq('module_version_id', moduleVersionId)
      .order('sort_order', { ascending: true })
    if (questionErr) throw new Error(questionErr.message)

    // A version with no questions scores 100 by definition (possiblePoints
    // is zero), so without this gate a bare `{"answers":{}}` POST writes a
    // passing, version-bound completion — the exact record an auditor pulls.
    // The learner UI has always sent an acknowledgement here; now the server
    // requires it instead of trusting the client to have asked.
    if ((questions ?? []).length === 0 && answersByQuestionId.acknowledgement !== true) {
      return NextResponse.json(
        { error: 'Acknowledge that you reviewed the instruction before submitting.' },
        { status: 422 },
      )
    }

    const questionIds = (questions ?? []).map(q => q.id as string)
    const { data: answers, error: answerErr } = questionIds.length > 0
      ? await admin
        .from('strike_quiz_answers')
        .select('id,question_id,is_correct')
        .in('question_id', questionIds)
      : { data: [], error: null }
    if (answerErr) throw new Error(answerErr.message)

    const correctAnswerIdsByQuestion = new Map<string, string[]>()
    for (const answer of answers ?? []) {
      if (!answer.is_correct) continue
      const questionId = answer.question_id as string
      const list = correctAnswerIdsByQuestion.get(questionId) ?? []
      list.push(answer.id as string)
      correctAnswerIdsByQuestion.set(questionId, list)
    }

    const score = scoreStrikeQuiz({
      passingScore: version.passing_score as number,
      answersByQuestionId,
      questions: (questions ?? []).map(q => ({
        questionId: q.id as string,
        questionType: q.question_type as StrikeQuestionType,
        required: q.required as boolean,
        points: q.points as number,
        correctAnswerIds: correctAnswerIdsByQuestion.get(q.id as string) ?? [],
      })),
    })

    const now = new Date().toISOString()
    const { data: attempt, error: attemptErr } = await admin
      .from('strike_attempts')
      .insert({
        tenant_id: gate.tenantId,
        module_id: moduleId,
        module_version_id: moduleVersionId,
        assignment_id: assignmentId,
        user_id: gate.userId,
        submitted_at: now,
        score_percent: score.scorePercent,
        passed: score.passed,
        answers: answersByQuestionId,
        client_context: {
          mode: 'learner_player',
          missed_question_ids: score.missedQuestionIds,
          ...(watch ? { watch, watch_evidence: 'client_claimed' } : {}),
        },
      })
      .select('id')
      .single()
    if (attemptErr) throw new Error(attemptErr.message)

    if (score.passed) {
      const { error: completionErr } = await admin
        .from('strike_completions')
        .insert({
          tenant_id: gate.tenantId,
          module_id: moduleId,
          module_version_id: moduleVersionId,
          assignment_id: assignmentId,
          attempt_id: attempt.id,
          user_id: gate.userId,
          completed_at: now,
          score_percent: score.scorePercent,
          passed: true,
          source: assignmentId ? 'assigned' : 'library',
          evidence: {
            mode: 'quiz',
            earned_points: score.earnedPoints,
            possible_points: score.possiblePoints,
            ...(watch ? { watch, watch_evidence: 'client_claimed' } : {}),
          },
        })
      if (completionErr) throw new Error(completionErr.message)
    }

    // Explanations are revoked from `authenticated` (migration 259) precisely
    // so they can't be read before answering. Returning them here — only for
    // what the learner actually missed — is the feedback path that replaces
    // the old give-away render.
    const explanationByQuestionId = new Map(
      (questions ?? [])
        .filter(q => typeof q.explanation === 'string' && q.explanation.trim().length > 0)
        .map(q => [q.id as string, (q.explanation as string).trim()]),
    )
    const missedFeedback = score.missedQuestionIds.map(questionId => ({
      question_id: questionId,
      explanation: explanationByQuestionId.get(questionId) ?? null,
    }))

    return NextResponse.json(
      { attempt_id: attempt.id, ...score, missedFeedback },
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

function isAnswerMap(value: unknown): value is Record<string, string[] | string | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(v =>
    typeof v === 'string'
    || typeof v === 'boolean'
    || (Array.isArray(v) && v.every(item => typeof item === 'string')),
  )
}
