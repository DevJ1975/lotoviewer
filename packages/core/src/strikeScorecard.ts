// The microlearning (STRIKE) section of the EHS Scorecard: what management
// needs to see about training, computed once from raw rows so the dashboard
// and every export (PDF, Excel, Word) report the same numbers.
//
// Two rules keep the numbers honest:
// - A supervisor-verified (assisted / ADA) completion is a completion, but it
//   has no quiz, so it never enters a score or a pass rate.
// - A module is one thing in every language: a Spanish pass counts for the
//   module, and the language split is reported separately.

import { isStrikeCompletionCurrent, type StrikeVersionLineage } from './strike'
import { buildComplianceCells, complianceTotals, type ComplianceAssignment, type ComplianceMember, type ComplianceTotals } from './strikeCompliance'

const DAY_MS = 86_400_000
/** A current certification inside this many days of expiring needs a retrain scheduled. */
export const MICROLEARNING_EXPIRY_WARNING_DAYS = 30

export interface MicrolearningVersionRow {
  id: string
  moduleId: string
  locale: string
  versionNumber: number
  supersedesCompletions: boolean
}

/** A passed completion. All of them, not just the window's: currency and expiry need history. */
export interface MicrolearningCompletionRow {
  moduleId: string
  moduleVersionId: string
  memberId: string | null
  userId: string | null
  completedAt: string
  expiresAt: string | null
  /** Signed off by a supervisor in person (assisted / ADA delivery): no quiz score. */
  assisted: boolean
}

/** A submitted quiz attempt (standard delivery only), pass or fail. */
export interface MicrolearningAttemptRow {
  moduleId: string
  memberId: string | null
  userId: string | null
  submittedAt: string
  passed: boolean
  scorePercent: number | null
}

/** A learner's first try at one practice check (drag and drop, hotspot, scenario). */
export interface MicrolearningPracticeRow {
  correct: boolean
  hintsUsed: number
}

export interface MicrolearningInput {
  windowDays: number
  now: Date
  modules: { id: string; title: string }[]
  versions: MicrolearningVersionRow[]
  completions: MicrolearningCompletionRow[]
  attempts: MicrolearningAttemptRow[]
  /** First tries at practice checks inside the window. */
  practice: MicrolearningPracticeRow[]
  /** Active roster members: the workforce denominator. */
  members: ComplianceMember[]
  /** Active assignments. */
  assignments: ComplianceAssignment[]
  /** Workers let onto a permit without the required training, inside the window. */
  permitOverrideWorkers: number
}

/** A rate always travels with its counts, so a small sample is never overstated. */
export interface MicrolearningRate {
  numerator: number
  denominator: number
  /** Whole percent, or null when there is nothing to divide. */
  percent: number | null
}

export interface MicrolearningModuleSummary {
  moduleId: string
  title: string
  completions: number
  learners: number
  assisted: number
  byLocale: Record<string, number>
  passRate: MicrolearningRate
  averageScore: number | null
}

export interface MicrolearningTrendPoint {
  /** First day of the bucket (YYYY-MM-DD, UTC). */
  start: string
  completions: number
}

export interface MicrolearningSummary {
  windowDays: number
  generatedAt: string
  /** Passed completions inside the window. */
  completions: number
  /** Distinct people who passed something inside the window. */
  learners: number
  /** Active roster members holding at least one current pass, as of now. */
  workforceTrained: MicrolearningRate
  /** Submitted quiz attempts inside the window that passed. */
  passRate: MicrolearningRate
  /** Learner × module pairs whose first-ever attempt fell inside the window and passed. */
  firstTryPassRate: MicrolearningRate
  /** Mean quiz score of the window's submitted attempts, fails included. */
  averageScore: number | null
  delivery: { standard: number; assisted: number }
  /** Completions per language code, most first. */
  languages: { locale: string; completions: number }[]
  /** Assignment standing as of now. */
  compliance: ComplianceTotals
  /** Current certifications expiring within MICROLEARNING_EXPIRY_WARNING_DAYS. */
  expiringSoon: number
  /** Learner × module certifications that lapsed with no current pass to replace them. */
  expired: number
  practice: { firstTries: number; solvedFirstTry: MicrolearningRate; usedHint: MicrolearningRate }
  permitOverrideWorkers: number
  trend: { bucketDays: number; points: MicrolearningTrendPoint[] }
  /** Every module with activity or a current pass, most completions first. */
  modules: MicrolearningModuleSummary[]
}

export function rate(numerator: number, denominator: number): MicrolearningRate {
  return { numerator, denominator, percent: denominator === 0 ? null : Math.round((numerator / denominator) * 100) }
}

function learnerKey(row: { memberId: string | null; userId: string | null }): string {
  return row.memberId ? `member:${row.memberId}` : `user:${row.userId}`
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

function dayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/** The window is whole UTC days ending today: the same days the trend bars cover. */
export function microlearningWindowStart(now: Date, windowDays: number): Date {
  return new Date(dayStart(now) - (windowDays - 1) * DAY_MS)
}

export function summarizeMicrolearning(input: MicrolearningInput): MicrolearningSummary {
  const now = input.now
  const since = microlearningWindowStart(now, input.windowDays).getTime()
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime()
    return t >= since && t <= now.getTime()
  }

  const localeByVersion = new Map(input.versions.map(v => [v.id, v.locale]))
  const lineageByModule = new Map<string, StrikeVersionLineage[]>()
  for (const v of input.versions) {
    const list = lineageByModule.get(v.moduleId) ?? []
    list.push({ id: v.id, versionNumber: v.versionNumber, supersedesCompletions: v.supersedesCompletions })
    lineageByModule.set(v.moduleId, list)
  }
  const isCurrent = (c: MicrolearningCompletionRow) => isStrikeCompletionCurrent({
    completedAt: c.completedAt,
    expiresAt: c.expiresAt,
    moduleVersionId: c.moduleVersionId,
    lineage: lineageByModule.get(c.moduleId) ?? [],
    now,
  })

  const windowCompletions = input.completions.filter(c => inWindow(c.completedAt))
  const windowAttempts = input.attempts.filter(a => inWindow(a.submittedAt))

  // Latest pass per learner × module decides whether a certification is
  // current, about to expire, or lapsed.
  const latestByLearnerModule = new Map<string, MicrolearningCompletionRow>()
  for (const c of input.completions) {
    const key = `${learnerKey(c)}|${c.moduleId}`
    const latest = latestByLearnerModule.get(key)
    if (!latest || c.completedAt > latest.completedAt) latestByLearnerModule.set(key, c)
  }
  let expiringSoon = 0
  let expired = 0
  const warnUntil = now.getTime() + MICROLEARNING_EXPIRY_WARNING_DAYS * DAY_MS
  for (const latest of latestByLearnerModule.values()) {
    const expiresAt = latest.expiresAt ? new Date(latest.expiresAt).getTime() : null
    if (isCurrent(latest)) {
      if (expiresAt !== null && expiresAt <= warnUntil) expiringSoon++
    } else if (expiresAt !== null && expiresAt <= now.getTime()) {
      expired++
    }
  }

  const trained = input.members.filter(member => input.completions.some(c =>
    (c.memberId === member.id || (!!member.profileId && c.userId === member.profileId)) && isCurrent(c),
  )).length

  // First-ever attempt per learner × module; it counts when it fell in the window.
  const firstAttempt = new Map<string, MicrolearningAttemptRow>()
  for (const a of input.attempts) {
    const key = `${learnerKey(a)}|${a.moduleId}`
    const first = firstAttempt.get(key)
    if (!first || a.submittedAt < first.submittedAt) firstAttempt.set(key, a)
  }
  const firstInWindow = [...firstAttempt.values()].filter(a => inWindow(a.submittedAt))

  const localeCounts = new Map<string, number>()
  for (const c of windowCompletions) {
    const locale = localeByVersion.get(c.moduleVersionId) ?? 'en'
    localeCounts.set(locale, (localeCounts.get(locale) ?? 0) + 1)
  }

  const titleByModule = new Map(input.modules.map(m => [m.id, m.title]))
  const moduleIds = new Set([
    ...windowCompletions.map(c => c.moduleId),
    ...windowAttempts.map(a => a.moduleId),
  ])
  const modules: MicrolearningModuleSummary[] = [...moduleIds].map(moduleId => {
    const done = windowCompletions.filter(c => c.moduleId === moduleId)
    const tries = windowAttempts.filter(a => a.moduleId === moduleId)
    const byLocale: Record<string, number> = {}
    for (const c of done) {
      const locale = localeByVersion.get(c.moduleVersionId) ?? 'en'
      byLocale[locale] = (byLocale[locale] ?? 0) + 1
    }
    return {
      moduleId,
      title: titleByModule.get(moduleId) ?? 'Untitled module',
      completions: done.length,
      learners: new Set(done.map(learnerKey)).size,
      assisted: done.filter(c => c.assisted).length,
      byLocale,
      passRate: rate(tries.filter(a => a.passed).length, tries.length),
      averageScore: mean(tries.flatMap(a => (a.scorePercent === null ? [] : [a.scorePercent]))),
    }
  }).sort((a, b) => b.completions - a.completions || a.title.localeCompare(b.title))

  return {
    windowDays: input.windowDays,
    generatedAt: now.toISOString(),
    completions: windowCompletions.length,
    learners: new Set(windowCompletions.map(learnerKey)).size,
    workforceTrained: rate(trained, input.members.length),
    passRate: rate(windowAttempts.filter(a => a.passed).length, windowAttempts.length),
    firstTryPassRate: rate(firstInWindow.filter(a => a.passed).length, firstInWindow.length),
    averageScore: mean(windowAttempts.flatMap(a => (a.scorePercent === null ? [] : [a.scorePercent]))),
    delivery: {
      standard: windowCompletions.filter(c => !c.assisted).length,
      assisted: windowCompletions.filter(c => c.assisted).length,
    },
    languages: [...localeCounts].map(([locale, completions]) => ({ locale, completions }))
      .sort((a, b) => b.completions - a.completions || a.locale.localeCompare(b.locale)),
    compliance: complianceTotals(buildComplianceCells({
      members: input.members,
      assignments: input.assignments,
      completions: input.completions,
      lineageByModule,
      now,
    })),
    expiringSoon,
    expired,
    practice: {
      firstTries: input.practice.length,
      solvedFirstTry: rate(input.practice.filter(p => p.correct).length, input.practice.length),
      usedHint: rate(input.practice.filter(p => p.hintsUsed > 0).length, input.practice.length),
    },
    permitOverrideWorkers: input.permitOverrideWorkers,
    trend: completionTrend(windowCompletions, input.windowDays, now),
    modules,
  }
}

/** Daily buckets for a month or less, weekly beyond: enough bars to read a trend, few enough to label. */
function completionTrend(completions: MicrolearningCompletionRow[], windowDays: number, now: Date): MicrolearningSummary['trend'] {
  const bucketDays = windowDays <= 31 ? 1 : 7
  const bucketCount = Math.ceil(windowDays / bucketDays)
  const lastStart = dayStart(now) - (bucketDays - 1) * DAY_MS
  const starts = Array.from({ length: bucketCount }, (_, i) => lastStart - (bucketCount - 1 - i) * bucketDays * DAY_MS)
  const counts = starts.map(() => 0)
  for (const c of completions) {
    const t = dayStart(new Date(c.completedAt))
    const index = starts.findIndex(start => t >= start && t < start + bucketDays * DAY_MS)
    if (index !== -1) counts[index]++
  }
  return {
    bucketDays,
    points: starts.map((start, i) => ({ start: new Date(start).toISOString().slice(0, 10), completions: counts[i] })),
  }
}
