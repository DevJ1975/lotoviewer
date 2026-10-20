// Tenant-wide STRIKE compliance: for every roster member, every module they
// are assigned, and whether they hold a current pass. Pure, so the admin
// matrix, the CSV export and the reminder cron compute it the same way.

import { isStrikeAssignmentApplicable, isStrikeCompletionCurrent, type StrikeVersionLineage } from './strike'
import { assignmentStanding, type StrikeAssignmentStanding } from './strikeSchedule'

export interface ComplianceMember {
  id: string
  displayName: string
  profileId: string | null
  role: string | null
  department: string | null
  site: string | null
}

export interface ComplianceAssignment {
  id: string
  moduleId: string
  targetType: string
  targetId: string | null
  startsAt: string | null
  dueAt: string | null
}

export interface ComplianceCompletion {
  moduleId: string
  moduleVersionId: string
  memberId: string | null
  userId: string | null
  completedAt: string
  expiresAt: string | null
}

export interface ComplianceCell {
  memberId: string
  moduleId: string
  assignmentId: string
  standing: StrikeAssignmentStanding
  dueAt: string | null
  completedAt: string | null
}

export interface ComplianceInput {
  members: ComplianceMember[]
  assignments: ComplianceAssignment[]
  completions: ComplianceCompletion[]
  lineageByModule: Map<string, StrikeVersionLineage[]>
  now: Date
}

export function buildComplianceCells(input: ComplianceInput): ComplianceCell[] {
  const cells: ComplianceCell[] = []
  for (const member of input.members) {
    // One cell per module: when several assignments cover a member, the one
    // due soonest is the one that matters.
    const byModule = new Map<string, ComplianceAssignment>()
    for (const assignment of input.assignments) {
      const applies = isStrikeAssignmentApplicable({
        targetType: assignment.targetType,
        targetId: assignment.targetId,
        userId: member.profileId,
        role: member.role,
        department: member.department,
        site: member.site,
      })
      if (!applies) continue
      const existing = byModule.get(assignment.moduleId)
      if (!existing || dueTime(assignment) < dueTime(existing)) byModule.set(assignment.moduleId, assignment)
    }

    for (const [moduleId, assignment] of byModule) {
      const current = latestCurrentCompletion(input, member, moduleId)
      cells.push({
        memberId: member.id,
        moduleId,
        assignmentId: assignment.id,
        standing: assignmentStanding({ startsAt: assignment.startsAt, dueAt: assignment.dueAt, completed: !!current }, input.now),
        dueAt: assignment.dueAt,
        completedAt: current?.completedAt ?? null,
      })
    }
  }
  return cells
}

function latestCurrentCompletion(input: ComplianceInput, member: ComplianceMember, moduleId: string): ComplianceCompletion | null {
  const lineage = input.lineageByModule.get(moduleId) ?? []
  let best: ComplianceCompletion | null = null
  for (const c of input.completions) {
    if (c.moduleId !== moduleId) continue
    const mine = c.memberId === member.id || (!!member.profileId && c.userId === member.profileId)
    if (!mine) continue
    if (!isStrikeCompletionCurrent({ completedAt: c.completedAt, expiresAt: c.expiresAt, moduleVersionId: c.moduleVersionId, lineage, now: input.now })) continue
    if (!best || c.completedAt > best.completedAt) best = c
  }
  return best
}

function dueTime(assignment: ComplianceAssignment): number {
  return assignment.dueAt ? new Date(assignment.dueAt).getTime() : Number.POSITIVE_INFINITY
}

export interface ComplianceTotals {
  assigned: number
  complete: number
  overdue: number
  dueSoon: number
  upcoming: number
  percentComplete: number
}

/** Upcoming (unreleased) work is excluded from the completion rate: nobody can be late on it yet. */
export function complianceTotals(cells: ComplianceCell[]): ComplianceTotals {
  const count = (s: StrikeAssignmentStanding) => cells.filter(c => c.standing === s).length
  const upcoming = count('upcoming')
  const assigned = cells.length - upcoming
  const complete = count('complete')
  return {
    assigned,
    complete,
    overdue: count('overdue'),
    dueSoon: count('due_soon'),
    upcoming,
    percentComplete: assigned === 0 ? 100 : Math.round((complete / assigned) * 100),
  }
}

export interface MissedQuestionStat {
  questionId: string
  missed: number
  attempts: number
  missRate: number
}

/**
 * Item analysis over submitted attempts: which knowledge-check questions are
 * missed most. A question most people miss usually means the content didn't
 * teach it, not that the workforce is careless.
 */
export function missedQuestionStats(attempts: { missedQuestionIds: string[]; questionIds: string[] }[], minAttempts = 5): MissedQuestionStat[] {
  const missed = new Map<string, number>()
  const seen = new Map<string, number>()
  for (const attempt of attempts) {
    for (const id of attempt.questionIds) seen.set(id, (seen.get(id) ?? 0) + 1)
    for (const id of attempt.missedQuestionIds) missed.set(id, (missed.get(id) ?? 0) + 1)
  }
  return [...seen.entries()]
    .filter(([, n]) => n >= minAttempts)
    .map(([questionId, n]) => ({ questionId, attempts: n, missed: missed.get(questionId) ?? 0, missRate: Math.round(((missed.get(questionId) ?? 0) / n) * 100) }))
    .sort((a, b) => b.missRate - a.missRate || b.attempts - a.attempts)
}

export function complianceCsv(
  cells: ComplianceCell[],
  memberNames: Map<string, string>,
  moduleTitles: Map<string, string>,
): string {
  const header = ['Worker', 'Module', 'Status', 'Due', 'Completed']
  const rows = cells.map(c => [
    memberNames.get(c.memberId) ?? c.memberId,
    moduleTitles.get(c.moduleId) ?? c.moduleId,
    c.standing.replace('_', ' '),
    c.dueAt ? c.dueAt.slice(0, 10) : '',
    c.completedAt ? c.completedAt.slice(0, 10) : '',
  ])
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n')
}

function csvCell(value: string): string {
  // Neutralise spreadsheet formula injection from roster names.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
