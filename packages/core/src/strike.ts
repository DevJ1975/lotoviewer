export const STRIKE_LIBRARY_SCOPES = ['global', 'tenant'] as const
export const STRIKE_MODULE_STATUSES = ['draft', 'in_review', 'published', 'archived', 'superseded'] as const
export const STRIKE_QUESTION_TYPES = ['multiple_choice', 'true_false', 'select_all', 'acknowledgement'] as const
export const STRIKE_ASSIGNMENT_TARGET_TYPES = ['tenant', 'site', 'department', 'role', 'user'] as const
export const STRIKE_REQUIREMENT_SOURCE_TYPES = [
  'loto',
  'confined_space',
  'hot_work',
  'jha',
  'chemical',
  'bbs',
  'incident',
  'incident_action',
  'safety_board',
  'manual',
  'custom',
] as const
export const STRIKE_READINESS_STATUSES = ['ready', 'partial', 'blocked', 'not_required'] as const

export type StrikeLibraryScope = typeof STRIKE_LIBRARY_SCOPES[number]
export type StrikeModuleStatus = typeof STRIKE_MODULE_STATUSES[number]
export type StrikeQuestionType = typeof STRIKE_QUESTION_TYPES[number]
export type StrikeAssignmentTargetType = typeof STRIKE_ASSIGNMENT_TARGET_TYPES[number]
export type StrikeRequirementSourceType = typeof STRIKE_REQUIREMENT_SOURCE_TYPES[number]
export type StrikeReadinessStatus = typeof STRIKE_READINESS_STATUSES[number]

export interface StrikeCompletionLike {
  completedAt: string | Date | null | undefined
  expiresAt?: string | Date | null | undefined
  moduleVersionId?: string | null | undefined
}

export interface StrikeCompletionCurrencyInput extends StrikeCompletionLike {
  requiredVersionId?: string | null | undefined
  now?: string | Date
}

export interface StrikeReadinessInput {
  requiredCount: number
  validCompletionCount: number
}

export interface StrikeAssignmentApplicabilityInput {
  targetType: StrikeAssignmentTargetType | string
  targetId: string | null | undefined
  userId: string | null | undefined
  role: string | null | undefined
}

export interface StrikeReadinessResult {
  status: StrikeReadinessStatus
  percent: number
  missingCount: number
}

export interface StrikeQuizAnswerKey {
  questionId: string
  questionType: StrikeQuestionType
  required?: boolean
  points?: number
  correctAnswerIds: string[]
}

export interface StrikeQuizScoreInput {
  questions: StrikeQuizAnswerKey[]
  answersByQuestionId: Record<string, string[] | string | boolean | null | undefined>
  passingScore: number
}

export interface StrikeQuizScoreResult {
  scorePercent: number
  earnedPoints: number
  possiblePoints: number
  passed: boolean
  missedQuestionIds: string[]
}

function toTime(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

export function isStrikeCompletionCurrent(input: StrikeCompletionCurrencyInput): boolean {
  const completedAt = toTime(input.completedAt)
  if (completedAt === null) return false

  if (input.requiredVersionId && input.moduleVersionId && input.requiredVersionId !== input.moduleVersionId) {
    return false
  }

  const expiresAt = toTime(input.expiresAt)
  if (expiresAt === null) return true

  const now = toTime(input.now ?? new Date())
  return now !== null && expiresAt >= now
}

export function computeStrikeReadiness(input: StrikeReadinessInput): StrikeReadinessResult {
  const requiredCount = Math.max(0, Math.floor(input.requiredCount))
  const validCompletionCount = Math.max(0, Math.floor(input.validCompletionCount))

  if (requiredCount === 0) {
    return { status: 'not_required', percent: 100, missingCount: 0 }
  }

  const cappedValid = Math.min(requiredCount, validCompletionCount)
  const percent = Math.round((cappedValid / requiredCount) * 100)
  const missingCount = requiredCount - cappedValid

  if (missingCount === 0) return { status: 'ready', percent, missingCount }
  if (cappedValid > 0) return { status: 'partial', percent, missingCount }
  return { status: 'blocked', percent, missingCount }
}

export function isStrikeAssignmentApplicable(input: StrikeAssignmentApplicabilityInput): boolean {
  if (input.targetType === 'tenant') return input.targetId == null || input.targetId === ''
  if (input.targetType === 'user') return !!input.userId && input.targetId === input.userId
  if (input.targetType === 'role') return !!input.role && input.targetId === input.role

  // Site and department targeting need worker profile context that is not
  // part of the STRIKE shell yet. Keep them tenant-scoped at the API layer
  // but do not infer learner applicability from this pure helper.
  return false
}

export function scoreStrikeQuiz(input: StrikeQuizScoreInput): StrikeQuizScoreResult {
  const requiredQuestions = input.questions.filter(q => q.required !== false)
  const questions = requiredQuestions.length > 0 ? requiredQuestions : input.questions
  const possiblePoints = questions.reduce((sum, q) => sum + Math.max(0, q.points ?? 1), 0)
  const missedQuestionIds: string[] = []
  let earnedPoints = 0

  for (const question of questions) {
    const points = Math.max(0, question.points ?? 1)
    const expected = new Set(question.correctAnswerIds)
    const actual = normalizeSubmittedAnswer(input.answersByQuestionId[question.questionId])

    const correct = question.questionType === 'acknowledgement'
      ? actual.size > 0 || input.answersByQuestionId[question.questionId] === true
      : expected.size > 0 && setsEqual(expected, actual)

    if (correct) earnedPoints += points
    else missedQuestionIds.push(question.questionId)
  }

  const scorePercent = possiblePoints === 0
    ? 100
    : Math.round((earnedPoints / possiblePoints) * 100)
  const passingScore = Math.max(0, Math.min(100, Math.round(input.passingScore)))

  return {
    scorePercent,
    earnedPoints,
    possiblePoints,
    passed: scorePercent >= passingScore,
    missedQuestionIds,
  }
}

export function normalizeStrikeSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return slug || 'strike-module'
}

function normalizeSubmittedAnswer(value: string[] | string | boolean | null | undefined): Set<string> {
  if (Array.isArray(value)) return new Set(value.filter(Boolean))
  if (typeof value === 'string' && value) return new Set([value])
  if (value === true) return new Set(['acknowledged'])
  return new Set()
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}
