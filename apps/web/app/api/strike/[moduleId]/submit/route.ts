import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  evaluateStrikeWatchGate,
  isStrikeAssignmentApplicable,
  scoreStrikeQuiz,
  type StrikeAssignmentTargetType,
  type StrikeQuestionType,
} from '@soteria/core/strike'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SubmitBody {
  module_version_id?: unknown
  assignment_id?: unknown
  answers?: unknown
  watched_seconds?: unknown
}

// The watch threshold itself lives in @soteria/core/strike so the client
// and server agree. We use evaluateStrikeWatchGate() to compute the gate
// — see strike.test.ts for boundary coverage.

interface RouteContext {
  params: Promise<{ moduleId: string }>
}

export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  if (!UUID_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid module id' }, { status: 400 })

  let body: SubmitBody
  try { body = await req.json() as SubmitBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const moduleVersionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(moduleVersionId)) return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })

  const assignmentId = typeof body.assignment_id === 'string' && UUID_RE.test(body.assignment_id)
    ? body.assignment_id
    : null
  const answersByQuestionId = isAnswerMap(body.answers) ? body.answers : {}
  const rawWatched = typeof body.watched_seconds === 'number' ? body.watched_seconds : Number(body.watched_seconds)
  const watchedSeconds = Number.isFinite(rawWatched) && rawWatched >= 0 ? Math.floor(rawWatched) : 0

  try {
    const admin = supabaseAdmin()

    const { data: moduleRow, error: moduleErr } = await admin
      .from('strike_modules')
      .select('id,tenant_id,library_scope,status')
      .eq('id', moduleId)
      .maybeSingle()
    if (moduleErr) throw new Error(moduleErr.message)
    if (!moduleRow || moduleRow.status !== 'published') {
      return NextResponse.json({ error: 'Module not found' }, { status: 404 })
    }
    if (
      moduleRow.library_scope === 'tenant'
      && moduleRow.tenant_id !== gate.tenantId
      && gate.role !== 'superadmin'
    ) {
      return NextResponse.json({ error: 'Module not found' }, { status: 404 })
    }

    const { data: version, error: versionErr } = await admin
      .from('strike_module_versions')
      .select('id,module_id,tenant_id,library_scope,status,passing_score,video_path,duration_seconds')
      .eq('id', moduleVersionId)
      .eq('module_id', moduleId)
      .maybeSingle()
    if (versionErr) throw new Error(versionErr.message)
    if (!version || version.status !== 'published') {
      return NextResponse.json({ error: 'Published version not found' }, { status: 404 })
    }

    // We still accept the attempt below threshold but refuse to mark it
    // passed even if the quiz score itself is perfect — the learner sees a
    // "watch the video to complete" hint and the attempt row records why.
    const watchGate = evaluateStrikeWatchGate({
      hasVideo: typeof version.video_path === 'string' && version.video_path.trim().length > 0,
      durationSeconds: typeof version.duration_seconds === 'number' ? version.duration_seconds : null,
      watchedSeconds,
    })

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
      .select('id,question_type,required,points')
      .eq('module_version_id', moduleVersionId)
      .order('sort_order', { ascending: true })
    if (questionErr) throw new Error(questionErr.message)

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

    const completionEligible = score.passed && watchGate.met
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
        passed: completionEligible,
        answers: answersByQuestionId,
        client_context: {
          mode: 'learner_player',
          missed_question_ids: score.missedQuestionIds,
          watched_seconds: watchedSeconds,
          watch_required_seconds: watchGate.requiredSeconds,
          watch_met: watchGate.met,
        },
      })
      .select('id')
      .single()
    if (attemptErr) throw new Error(attemptErr.message)

    if (completionEligible) {
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
          },
        })
      if (completionErr) throw new Error(completionErr.message)
    }

    return NextResponse.json({
      attempt_id: attempt.id,
      ...score,
      passed: completionEligible,
      watch_met: watchGate.met,
      watch_required_seconds: watchGate.requiredSeconds,
      watched_seconds: watchedSeconds,
    }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'strike/submit' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function isAnswerMap(value: unknown): value is Record<string, string[] | string | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(v =>
    typeof v === 'string'
    || typeof v === 'boolean'
    || (Array.isArray(v) && v.every(item => typeof item === 'string')),
  )
}
