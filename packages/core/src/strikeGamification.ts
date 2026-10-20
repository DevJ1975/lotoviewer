// STRIKE gamification, per the arbitrated decisions in
// docs/handoffs/2026-08-29-strike-phase-2.md:
//
//   * An append-only ledger of events, never a counter. Each event carries a
//     dedupe key, and the database's unique (tenant, member, type, key)
//     index makes re-passing the same version worth nothing.
//   * No speed points: rewarding fast completion rewards skimming
//     hazardous-energy content, and it is discoverable in litigation.
//   * No daily streaks: impossible at a few modules a month, and penalising
//     absence suppresses honest reporting.
//   * Never score-based: an 80% pass and a 100% pass earn the same, so no
//     one is nudged to game the quiz.

export const STRIKE_XP_EVENT_TYPES = ['module_passed', 'on_time', 'practice_solved', 'curriculum_complete'] as const
export type StrikeXpEventType = typeof STRIKE_XP_EVENT_TYPES[number]

export const STRIKE_XP_POINTS: Record<StrikeXpEventType, number> = {
  module_passed: 100,
  on_time: 25,
  practice_solved: 5,
  curriculum_complete: 150,
}

export interface StrikeXpEvent {
  eventType: StrikeXpEventType
  dedupeKey: string
  points: number
  moduleId: string | null
}

export interface StrikePassContext {
  moduleId: string
  versionId: string
  passedAt: Date
  assignment: { id: string; dueAt: string | null } | null
  solvedBlockKeys: string[]
}

/** Ledger events a pass earns. Dedupe keys make every event idempotent. */
export function xpEventsForPass(ctx: StrikePassContext): StrikeXpEvent[] {
  const events: StrikeXpEvent[] = [
    { eventType: 'module_passed', dedupeKey: `version:${ctx.versionId}`, points: STRIKE_XP_POINTS.module_passed, moduleId: ctx.moduleId },
  ]
  const due = ctx.assignment?.dueAt ? new Date(ctx.assignment.dueAt).getTime() : null
  if (ctx.assignment && due !== null && ctx.passedAt.getTime() <= due) {
    events.push({ eventType: 'on_time', dedupeKey: `assignment:${ctx.assignment.id}:due:${ctx.assignment.dueAt}`, points: STRIKE_XP_POINTS.on_time, moduleId: ctx.moduleId })
  }
  for (const key of [...new Set(ctx.solvedBlockKeys)]) {
    events.push({ eventType: 'practice_solved', dedupeKey: `version:${ctx.versionId}:block:${key}`, points: STRIKE_XP_POINTS.practice_solved, moduleId: ctx.moduleId })
  }
  return events
}

export function curriculumCompleteEvent(curriculumId: string): StrikeXpEvent {
  return { eventType: 'curriculum_complete', dedupeKey: `curriculum:${curriculumId}`, points: STRIKE_XP_POINTS.curriculum_complete, moduleId: null }
}

// ── Badges (derived, never stored) ──────────────────────────────────────

export interface StrikeBadge {
  id: 'first_module' | 'loto_ready' | 'on_time_finisher' | 'curriculum_complete' | 'safety_scholar'
  label: string
  description: string
}

const BADGES: Record<StrikeBadge['id'], Omit<StrikeBadge, 'id'>> = {
  first_module: { label: 'First Strike', description: 'Passed your first module.' },
  loto_ready: { label: 'LOTO Ready', description: 'Passed lockout/tagout training.' },
  on_time_finisher: { label: 'On-Time Finisher', description: 'Finished three assignments by their due date.' },
  curriculum_complete: { label: 'Curriculum Complete', description: 'Finished every module in a curriculum.' },
  safety_scholar: { label: 'Safety Scholar', description: 'Passed five different modules.' },
}

export interface StrikeLedgerRow {
  eventType: StrikeXpEventType
  points: number
  moduleId: string | null
}

export function deriveBadges(rows: StrikeLedgerRow[], lotoModuleIds: ReadonlySet<string>): StrikeBadge[] {
  const passed = new Set(rows.filter(r => r.eventType === 'module_passed' && r.moduleId).map(r => r.moduleId as string))
  const earned: StrikeBadge['id'][] = []
  if (passed.size >= 1) earned.push('first_module')
  if ([...passed].some(id => lotoModuleIds.has(id))) earned.push('loto_ready')
  if (rows.filter(r => r.eventType === 'on_time').length >= 3) earned.push('on_time_finisher')
  if (rows.some(r => r.eventType === 'curriculum_complete')) earned.push('curriculum_complete')
  if (passed.size >= 5) earned.push('safety_scholar')
  return earned.map(id => ({ id, ...BADGES[id] }))
}

export function totalXp(rows: { points: number }[]): number {
  return rows.reduce((sum, r) => sum + r.points, 0)
}

// ── Leaderboards ─────────────────────────────────────────────────────────

export interface TeamStanding {
  team: string
  members: number
  xpPerMember: number
}

/**
 * Teams ranked by XP per member, so a large department doesn't win just by
 * headcount. Teams with fewer than `minMembers` are hidden: a two-person
 * "team" is effectively an individual board nobody opted into.
 */
export function rankTeams(rows: { team: string | null; xp: number }[], minMembers = 3): TeamStanding[] {
  const byTeam = new Map<string, { members: number; xp: number }>()
  for (const row of rows) {
    const team = row.team?.trim()
    if (!team) continue
    const entry = byTeam.get(team) ?? { members: 0, xp: 0 }
    entry.members += 1
    entry.xp += row.xp
    byTeam.set(team, entry)
  }
  return [...byTeam.entries()]
    .filter(([, t]) => t.members >= minMembers)
    .map(([team, t]) => ({ team, members: t.members, xpPerMember: Math.round(t.xp / t.members) }))
    .sort((a, b) => b.xpPerMember - a.xpPerMember || a.team.localeCompare(b.team))
}

/** 1-based rank of `xp` among everyone's totals (ties share a rank). Shown only to the learner. */
export function privateRank(xp: number, everyone: number[]): { rank: number; of: number } {
  return { rank: everyone.filter(other => other > xp).length + 1, of: Math.max(everyone.length, 1) }
}
