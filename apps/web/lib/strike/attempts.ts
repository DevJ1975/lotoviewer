import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isStrikeAssignmentApplicable,
  scoreStrikeQuiz,
  type StrikeAssignmentTargetType,
  type StrikeQuestionType,
  type StrikeQuizScoreResult,
} from '@soteria/core/strike'
import {
  missingRequiredBlocks,
  parseStrikeContent,
  STRIKE_BLOCK_EVENTS,
  type StrikeBlockEvent,
  type StrikeBlockEventRecord,
  type StrikeContent,
} from '@soteria/core/strikeContent'
import type { StrikeVersionRow } from '@/lib/strike/moduleAccess'
import { awardPassXp } from '@/lib/strike/xp'

// The attempt lifecycle shared by the signed-in learner routes and the
// kiosk ("Train now") routes: open an attempt, record block evidence, then
// grade and record. Everything here runs on the service-role client, so the
// callers' gates are the only access control in the path — every function
// re-checks that the attempt belongs to the learner it was handed.

/** Who is learning. Kiosk learners are roster members with no login. */
export interface StrikeLearner {
  tenantId: string
  userId: string | null
  memberId: string | null
  role: string | null
  channel: 'account' | 'kiosk'
  /** Supervisor who issued the kiosk token, recorded as evidence. */
  kioskIssuedBy?: string
}

export type StrikeResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string }

const REUSE_OPEN_ATTEMPT_MS = 24 * 60 * 60 * 1000
const MAX_EVENTS_PER_BATCH = 50

export async function resolveMemberIdForUser(
  admin: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('members')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('profile_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.id as string | undefined) ?? null
}

/** The version's parsed blocks, or null for a legacy video-only version. */
export function versionContent(version: Pick<StrikeVersionRow, 'content'>): StrikeContent | null {
  if (version.content == null) return null
  const parsed = parseStrikeContent(version.content)
  // A published version passed preflight; a parse failure here means the
  // stored document was edited outside the app and must not be gradeable.
  if (!parsed.ok) throw new Error(`Published STRIKE content failed validation: ${parsed.issues[0]?.message}`)
  return parsed.content
}

/** The column that identifies this learner's rows: their account, or their roster entry for kiosk learners. */
function learnerKey(learner: StrikeLearner): ['user_id' | 'member_id', string] {
  return learner.userId ? ['user_id', learner.userId] : ['member_id', learner.memberId as string]
}

// ── Open ────────────────────────────────────────────────────────────────

export interface OpenedAttempt {
  attemptId: string
  reached: StrikeBlockEventRecord[]
  resumed: boolean
}

export async function openAttempt(
  admin: SupabaseClient,
  learner: StrikeLearner,
  opts: { moduleId: string; version: StrikeVersionRow; assignmentId: string | null },
): Promise<OpenedAttempt> {
  const since = new Date(Date.now() - REUSE_OPEN_ATTEMPT_MS).toISOString()
  const [learnerColumn, learnerValue] = learnerKey(learner)
  const { data: open, error: openErr } = await admin
    .from('strike_attempts')
    .select('id')
    .eq('tenant_id', learner.tenantId)
    .eq('module_version_id', opts.version.id)
    .eq(learnerColumn, learnerValue)
    .is('submitted_at', null)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (openErr) throw new Error(openErr.message)

  if (open) {
    const { data: events, error: eventsErr } = await admin
      .from('strike_block_events')
      .select('block_key,event')
      .eq('attempt_id', open.id)
    if (eventsErr) throw new Error(eventsErr.message)
    return { attemptId: open.id as string, reached: (events ?? []) as StrikeBlockEventRecord[], resumed: true }
  }

  const { data: created, error: createErr } = await admin
    .from('strike_attempts')
    .insert({
      tenant_id: learner.tenantId,
      module_id: opts.moduleId,
      module_version_id: opts.version.id,
      assignment_id: opts.assignmentId,
      user_id: learner.userId,
      member_id: learner.memberId,
      client_context: { mode: learner.channel === 'kiosk' ? 'kiosk_player' : 'learner_player' },
    })
    .select('id')
    .single()
  if (createErr) throw new Error(createErr.message)
  return { attemptId: created.id as string, reached: [], resumed: false }
}

// ── Evidence ────────────────────────────────────────────────────────────

export interface IncomingBlockEvent {
  block_key: string
  event: StrikeBlockEvent
  dwell_ms: number | null
  detail: Record<string, unknown>
}

export function parseBlockEvents(value: unknown): IncomingBlockEvent[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVENTS_PER_BATCH) return null
  const events: IncomingBlockEvent[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const record = raw as Record<string, unknown>
    if (typeof record.block_key !== 'string') return null
    if (!(STRIKE_BLOCK_EVENTS as readonly string[]).includes(record.event as string)) return null
    const dwell = typeof record.dwell_ms === 'number' && Number.isFinite(record.dwell_ms)
      ? Math.max(0, Math.min(3_600_000, Math.round(record.dwell_ms)))
      : null
    const detail = record.detail && typeof record.detail === 'object' && !Array.isArray(record.detail)
      ? record.detail as Record<string, unknown>
      : {}
    if (JSON.stringify(detail).length > 2000) return null
    events.push({ block_key: record.block_key, event: record.event as StrikeBlockEvent, dwell_ms: dwell, detail })
  }
  return events
}

export async function recordBlockEvents(
  admin: SupabaseClient,
  learner: StrikeLearner,
  opts: { moduleId: string; version: StrikeVersionRow; attemptId: string; events: IncomingBlockEvent[] },
): Promise<StrikeResult<{ recorded: number }>> {
  const content = versionContent(opts.version)
  if (!content) return { ok: false, status: 400, message: 'This module has no interactive content.' }

  const attempt = await loadOwnedOpenAttempt(admin, learner, opts.attemptId, opts.version.id)
  if (!attempt.ok) return attempt

  const knownKeys = new Set(content.blocks.map(b => b.key))
  const unknown = opts.events.find(e => !knownKeys.has(e.block_key))
  if (unknown) return { ok: false, status: 400, message: `Unknown block "${unknown.block_key}".` }

  const { error } = await admin
    .from('strike_block_events')
    .upsert(
      opts.events.map(e => ({
        tenant_id: learner.tenantId,
        attempt_id: opts.attemptId,
        block_key: e.block_key,
        event: e.event,
        dwell_ms: e.dwell_ms,
        detail: e.detail,
      })),
      { onConflict: 'attempt_id,block_key,event', ignoreDuplicates: true },
    )
  if (error) throw new Error(error.message)
  return { ok: true, value: { recorded: opts.events.length } }
}

async function loadOwnedOpenAttempt(
  admin: SupabaseClient,
  learner: StrikeLearner,
  attemptId: string,
  versionId: string,
): Promise<StrikeResult<{ id: string }>> {
  const { data, error } = await admin
    .from('strike_attempts')
    .select('id,tenant_id,user_id,member_id,module_version_id,submitted_at')
    .eq('id', attemptId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const owned = !!data
    && data.tenant_id === learner.tenantId
    && data.module_version_id === versionId
    && (learner.userId ? data.user_id === learner.userId : data.member_id === learner.memberId)
  if (!owned) return { ok: false, status: 404, message: 'Attempt not found.' }
  if (data.submitted_at) return { ok: false, status: 409, message: 'This attempt was already submitted. Start a new one.' }
  return { ok: true, value: { id: data.id as string } }
}

// ── Grade and record ────────────────────────────────────────────────────

export type StrikeAnswerMap = Record<string, string[] | string | boolean>

export interface WatchProgress {
  percent_watched: number
  max_position_seconds: number | null
  duration_seconds: number | null
}

export interface GradedAttempt extends StrikeQuizScoreResult {
  attemptId: string
  missedFeedback: { question_id: string; explanation: string | null }[]
}

export async function gradeAndRecordAttempt(
  admin: SupabaseClient,
  learner: StrikeLearner,
  opts: {
    moduleId: string
    version: StrikeVersionRow
    attemptId: string | null
    assignmentId: string | null
    answers: StrikeAnswerMap
    watch: WatchProgress | null
  },
): Promise<StrikeResult<GradedAttempt>> {
  const { version } = opts

  if (version.retake_limit != null) {
    const [learnerColumn, learnerValue] = learnerKey(learner)
    const { count, error } = await admin
      .from('strike_attempts')
      .select('id', { count: 'exact', head: true })
      .eq(learnerColumn, learnerValue)
      .eq('module_version_id', version.id)
      .not('submitted_at', 'is', null)
    if (error) throw new Error(error.message)
    // Count-then-insert race accepted: a pacing limit, not a security boundary.
    if ((count ?? 0) >= version.retake_limit) {
      return { ok: false, status: 409, message: 'Retake limit reached for this module version.' }
    }
  }

  const content = versionContent(version)
  if (content) {
    if (!opts.attemptId) return { ok: false, status: 422, message: 'Start the module before submitting the knowledge check.' }
    const attempt = await loadOwnedOpenAttempt(admin, learner, opts.attemptId, version.id)
    if (!attempt.ok) return attempt
    const { data: events, error } = await admin
      .from('strike_block_events')
      .select('block_key,event')
      .eq('attempt_id', opts.attemptId)
    if (error) throw new Error(error.message)
    const missing = missingRequiredBlocks(content, (events ?? []) as StrikeBlockEventRecord[])
    if (missing.length > 0) {
      return { ok: false, status: 422, message: `Finish every section before the knowledge check (${missing.length} remaining).` }
    }
  }

  if (opts.assignmentId) {
    const assignment = await checkAssignment(admin, learner, opts.moduleId, version.id, opts.assignmentId)
    if (!assignment.ok) return assignment
  }

  const { data: questions, error: questionErr } = await admin
    .from('strike_quiz_questions')
    .select('id,question_type,required,points,explanation,graded')
    .eq('module_version_id', version.id)
    .order('sort_order', { ascending: true })
  if (questionErr) throw new Error(questionErr.message)
  const graded = (questions ?? []).filter(q => q.graded !== false)

  // A version with no questions scores 100 by definition, so without this a
  // bare POST would write a passing, version-bound completion.
  if (graded.length === 0 && opts.answers.acknowledgement !== true) {
    return { ok: false, status: 422, message: 'Acknowledge that you reviewed the instruction before submitting.' }
  }

  const questionIds = graded.map(q => q.id as string)
  const { data: answers, error: answerErr } = questionIds.length > 0
    ? await admin.from('strike_quiz_answers').select('id,question_id,is_correct').in('question_id', questionIds)
    : { data: [], error: null }
  if (answerErr) throw new Error(answerErr.message)

  const correctByQuestion = new Map<string, string[]>()
  for (const answer of answers ?? []) {
    if (!answer.is_correct) continue
    const list = correctByQuestion.get(answer.question_id as string) ?? []
    list.push(answer.id as string)
    correctByQuestion.set(answer.question_id as string, list)
  }

  const score = scoreStrikeQuiz({
    passingScore: version.passing_score,
    answersByQuestionId: opts.answers,
    questions: graded.map(q => ({
      questionId: q.id as string,
      questionType: q.question_type as StrikeQuestionType,
      required: q.required as boolean,
      points: q.points as number,
      correctAnswerIds: correctByQuestion.get(q.id as string) ?? [],
    })),
  })

  const now = new Date()
  const nowIso = now.toISOString()
  const clientContext = {
    mode: learner.channel === 'kiosk' ? 'kiosk_player' : 'learner_player',
    missed_question_ids: score.missedQuestionIds,
    ...(opts.watch ? { watch: opts.watch, watch_evidence: 'client_claimed' } : {}),
  }
  const attemptFields = {
    submitted_at: nowIso,
    score_percent: score.scorePercent,
    passed: score.passed,
    answers: opts.answers,
    client_context: clientContext,
  }

  const attemptId = opts.attemptId
    ? await updateAttempt(admin, opts.attemptId, attemptFields)
    : await insertAttempt(admin, learner, opts.moduleId, version.id, opts.assignmentId, attemptFields)

  if (score.passed) {
    const expiresAt = version.validity_days
      ? new Date(now.getTime() + version.validity_days * 86_400_000).toISOString()
      : null
    const { error: completionErr } = await admin
      .from('strike_completions')
      .insert({
        tenant_id: learner.tenantId,
        module_id: opts.moduleId,
        module_version_id: version.id,
        assignment_id: opts.assignmentId,
        attempt_id: attemptId,
        user_id: learner.userId,
        member_id: learner.memberId,
        completed_at: nowIso,
        expires_at: expiresAt,
        score_percent: score.scorePercent,
        passed: true,
        source: opts.assignmentId ? 'assigned' : 'library',
        evidence: {
          mode: content ? 'blocks_and_quiz' : 'quiz',
          channel: learner.channel,
          ...(learner.kioskIssuedBy ? { kiosk_issued_by: learner.kioskIssuedBy } : {}),
          earned_points: score.earnedPoints,
          possible_points: score.possiblePoints,
          ...(opts.watch ? { watch: opts.watch, watch_evidence: 'client_claimed' } : {}),
        },
      })
    if (completionErr) throw new Error(completionErr.message)

    await awardPassXp(admin, {
      tenantId: learner.tenantId,
      memberId: learner.memberId,
      moduleId: opts.moduleId,
      versionId: version.id,
      attemptId,
      assignmentId: opts.assignmentId,
      passedAt: now,
      interactionKeys: new Set((content?.blocks ?? []).filter(b => b.kind !== 'motion_scene' && b.kind !== 'callout').map(b => b.key)),
    })
  }

  // Explanations are column-revoked from the browser (260) so they can't be
  // read before answering; returning them only for missed questions, after
  // grading, is the feedback path.
  const explanationById = new Map(
    graded
      .filter(q => typeof q.explanation === 'string' && q.explanation.trim().length > 0)
      .map(q => [q.id as string, (q.explanation as string).trim()]),
  )
  const missedFeedback = score.missedQuestionIds.map(questionId => ({
    question_id: questionId,
    explanation: explanationById.get(questionId) ?? null,
  }))

  return { ok: true, value: { ...score, attemptId, missedFeedback } }
}

async function checkAssignment(
  admin: SupabaseClient,
  learner: StrikeLearner,
  moduleId: string,
  versionId: string,
  assignmentId: string,
): Promise<StrikeResult<null>> {
  const { data: assignment, error } = await admin
    .from('strike_assignments')
    .select('id,tenant_id,module_id,module_version_id,target_type,target_id,status')
    .eq('id', assignmentId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (
    !assignment
    || assignment.tenant_id !== learner.tenantId
    || assignment.module_id !== moduleId
    || assignment.status !== 'active'
    || (assignment.module_version_id && assignment.module_version_id !== versionId)
  ) {
    return { ok: false, status: 400, message: 'Assignment does not match this module.' }
  }
  if (!isStrikeAssignmentApplicable({
    targetType: assignment.target_type as StrikeAssignmentTargetType,
    targetId: assignment.target_id as string | null,
    userId: learner.userId,
    role: learner.role,
  })) {
    return { ok: false, status: 403, message: 'Assignment is not assigned to this user.' }
  }
  return { ok: true, value: null }
}

async function updateAttempt(admin: SupabaseClient, attemptId: string, fields: Record<string, unknown>): Promise<string> {
  // `is submitted_at null` makes a double-submit of one attempt a no-op
  // failure rather than two completions.
  const { data, error } = await admin
    .from('strike_attempts')
    .update(fields)
    .eq('id', attemptId)
    .is('submitted_at', null)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

async function insertAttempt(
  admin: SupabaseClient,
  learner: StrikeLearner,
  moduleId: string,
  versionId: string,
  assignmentId: string | null,
  fields: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin
    .from('strike_attempts')
    .insert({
      tenant_id: learner.tenantId,
      module_id: moduleId,
      module_version_id: versionId,
      assignment_id: assignmentId,
      user_id: learner.userId,
      member_id: learner.memberId,
      ...fields,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}
