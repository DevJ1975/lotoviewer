import { describe, expect, it } from 'vitest'
import {
  isStrikeAssignmentApplicable,
  isStrikeCompletionCurrent,
  scoreStrikeQuiz,
  strikeCompletionFloor,
  type StrikeQuizAnswerKey,
  type StrikeVersionLineage,
} from '../strike'
import { parseStrikeContent, scoreStrikeInteraction, type StrikeInteractionBlock } from '../strikeContent'
import { assignmentStanding, nextDueDate, strikeReminderFor, type StrikeRecurrenceRule } from '../strikeSchedule'
import { pickStrikeLocale } from '../strikeLocale'
import { summarizeMicrolearning, type MicrolearningInput } from '../strikeScorecard'
import { xpEventsForPass } from '../strikeGamification'

// Exhaustive sweeps of STRIKE's business rules. Each test walks a full
// cross-product of the inputs a rule branches on and asserts properties that
// must hold for every combination (never pass an empty quiz, never count an
// expired cert as current, ...). Violations are collected, not thrown, so one
// run shows every failing combination; each test also asserts how many cases
// it ran, so a refactor cannot quietly shrink the sweep.

function* cross<T extends unknown[][]>(...dims: T): Generator<{ [K in keyof T]: T[K][number] }> {
  if (dims.length === 0) { yield [] as unknown as { [K in keyof T]: T[K][number] }; return }
  const [first, ...rest] = dims
  for (const head of first) for (const tail of cross(...rest)) yield [head, ...tail] as { [K in keyof T]: T[K][number] }
}

/** Deterministic pseudo-random numbers, so a failing dataset can be replayed. */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 86_400_000
const NOW = new Date('2026-11-10T12:00:00Z')

describe('scoreStrikeQuiz', () => {
  it('scores every combination of question types, answers, points and pass marks consistently', () => {
    const types = ['multiple_choice', 'true_false', 'select_all', 'acknowledgement'] as const
    const answerShapes = ['none', 'empty', 'right', 'wrong', 'partial', 'superset', 'true', 'stringRight'] as const
    const pointsOptions = [undefined, 0, 1, 3] as const
    const passingOptions = [0, 1, 50, 79.5, 80, 100, 150, -10, NaN]
    const requiredOptions = [undefined, true, false] as const
    const violations: string[] = []
    let cases = 0

    for (const [typeA, typeB, shapeA, shapeB, pointsA, pointsB, passing, requiredB] of cross(
      types, types, answerShapes, answerShapes, pointsOptions, pointsOptions, passingOptions, requiredOptions,
    )) {
      cases++
      const key = (id: string, type: typeof types[number], points: number | undefined, required?: boolean): StrikeQuizAnswerKey => ({
        questionId: id,
        questionType: type,
        points,
        required,
        correctAnswerIds: type === 'acknowledgement' ? [] : type === 'select_all' ? [`${id}-a`, `${id}-b`] : [`${id}-a`],
      })
      const questions = [key('q1', typeA, pointsA), key('q2', typeB, pointsB, requiredB)]
      const answer = (q: StrikeQuizAnswerKey, shape: typeof answerShapes[number]) => {
        switch (shape) {
          case 'none': return undefined
          case 'empty': return []
          case 'right': return q.questionType === 'acknowledgement' ? true : q.correctAnswerIds
          case 'wrong': return [`${q.questionId}-z`]
          case 'partial': return q.correctAnswerIds.slice(0, 1)
          case 'superset': return [...q.correctAnswerIds, `${q.questionId}-z`]
          case 'true': return true
          case 'stringRight': return q.correctAnswerIds[0] ?? ''
        }
      }
      const answersByQuestionId = { q1: answer(questions[0], shapeA), q2: answer(questions[1], shapeB) }
      const r = scoreStrikeQuiz({ questions, answersByQuestionId, passingScore: passing })
      const where = `${typeA}/${shapeA}/${pointsA} + ${typeB}/${shapeB}/${pointsB}/req=${requiredB} pass=${passing}`

      if (!Number.isInteger(r.scorePercent) || r.scorePercent < 0 || r.scorePercent > 100) violations.push(`score out of range: ${where} → ${r.scorePercent}`)
      if (r.earnedPoints > r.possiblePoints) violations.push(`earned > possible: ${where}`)
      const clampedPass = Number.isFinite(passing) ? Math.max(0, Math.min(100, Math.round(passing))) : null
      if (clampedPass !== null && r.passed !== r.scorePercent >= clampedPass) violations.push(`pass flag disagrees with score: ${where}`)
      // A NaN pass mark is not a number a pass can be measured against.
      if (clampedPass === null && r.passed) violations.push(`passed against a NaN pass mark: ${where}`)
      // Answering nothing can never pass a quiz that has points to earn.
      if (shapeA === 'none' && shapeB === 'none' && r.possiblePoints > 0 && clampedPass !== null && clampedPass > 0 && r.passed) {
        violations.push(`blank quiz passed: ${where}`)
      }
      // A quiz with nothing to earn must not hand out a pass to everyone.
      if (r.possiblePoints === 0 && r.passed && clampedPass !== null && clampedPass > 0) {
        violations.push(`zero-point quiz passed everyone: ${where}`)
      }
      const graded = questions.filter(q => q.required !== false).length > 0 ? questions.filter(q => q.required !== false) : questions
      if (r.missedQuestionIds.some(id => !graded.some(q => q.questionId === id))) violations.push(`missed an ungraded question: ${where}`)
    }

    expect(violations.slice(0, 20)).toEqual([])
    expect(cases).toBe(4 * 4 * 8 * 8 * 4 * 4 * 9 * 3)
  })
})

describe('scoreStrikeInteraction', () => {
  function block(json: unknown): StrikeInteractionBlock {
    const parsed = parseStrikeContent({ blocks: [json] })
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    return parsed.content.blocks[0] as StrikeInteractionBlock
  }
  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items]
    return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(p => [item, ...p]))
  }
  function subsets<T>(items: T[]): T[][] {
    return items.reduce<T[][]>((acc, item) => [...acc, ...acc.map(s => [...s, item])], [[]])
  }

  it('solves a drag-sort only in the exact order, for every ordering', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const sort = block({ key: 'sort', kind: 'drag_sort', prompt: 'p', items: ids.map(id => ({ id, label: id })) })
    const violations: string[] = []
    let cases = 0
    for (const order of [...permutations(ids), ids.slice(0, 4), [...ids, 'a'], [], ['a', 'a', 'c', 'd', 'e']]) {
      cases++
      const r = scoreStrikeInteraction(sort, { kind: 'drag_sort', orderedIds: order })
      const exact = order.length === ids.length && order.every((id, i) => id === ids[i])
      if (r.correct !== exact) violations.push(`${order.join(',')} → ${r.correct}`)
      if (r.correct && r.incorrectIds.length > 0) violations.push(`correct with errors: ${order.join(',')}`)
    }
    expect(violations).toEqual([])
    expect(cases).toBe(120 + 4)
  })

  it('solves a match only when every pair is right, for every assignment', () => {
    const pairs = [{ id: 'p1', prompt: 'A', answer: 'x' }, { id: 'p2', prompt: 'B', answer: 'y' }, { id: 'p3', prompt: 'C', answer: 'z' }]
    const match = block({ key: 'm', kind: 'drag_match', prompt: 'p', pairs })
    const choices = ['x', 'y', 'z', undefined]
    const violations: string[] = []
    let cases = 0
    for (const [a, b, c] of cross(choices, choices, choices)) {
      cases++
      const answerByPairId = Object.fromEntries([['p1', a], ['p2', b], ['p3', c]].filter(([, v]) => v !== undefined)) as Record<string, string>
      const r = scoreStrikeInteraction(match, { kind: 'drag_match', answerByPairId })
      const exact = a === 'x' && b === 'y' && c === 'z'
      if (r.correct !== exact) violations.push(`${a},${b},${c}`)
      if (!exact && r.incorrectIds.length === 0) violations.push(`wrong but nothing flagged: ${a},${b},${c}`)
    }
    expect(violations).toEqual([])
    expect(cases).toBe(64)
  })

  it('solves a hotspot only when exactly the true isolation points are picked', () => {
    const targets = [
      { id: 't1', label: 'Disconnect', x_pct: 10, y_pct: 10, correct: true },
      { id: 't2', label: 'Valve', x_pct: 20, y_pct: 20, correct: true },
      { id: 't3', label: 'E-stop', x_pct: 30, y_pct: 30, correct: false },
      { id: 't4', label: 'Screen', x_pct: 40, y_pct: 40, correct: false },
    ]
    const hotspot = block({ key: 'h', kind: 'hotspot', prompt: 'p', image: { path: 'h.jpg', alt: 'a' }, targets })
    const violations: string[] = []
    let cases = 0
    for (const picked of subsets(['t1', 't2', 't3', 't4', 'unknown'])) {
      cases++
      const r = scoreStrikeInteraction(hotspot, { kind: 'hotspot', selectedIds: picked })
      const real = picked.filter(id => id !== 'unknown').sort().join(',')
      if (r.correct !== (real === 't1,t2')) violations.push(picked.join(','))
    }
    expect(violations).toEqual([])
    expect(cases).toBe(32)
  })

  it('never credits an answer of the wrong kind', () => {
    const scenario = block({ key: 's', kind: 'scenario', stem: 'q', choices: [{ id: 'c1', label: 'Right', correct: true, feedback: 'f' }, { id: 'c2', label: 'Wrong', correct: false, feedback: 'f' }] })
    const responses = [
      { kind: 'drag_sort' as const, orderedIds: ['c1'] },
      { kind: 'hotspot' as const, selectedIds: ['c1'] },
      { kind: 'drag_match' as const, answerByPairId: { c1: 'c1' } },
      { kind: 'scenario' as const, choiceId: 'missing' },
      { kind: 'scenario' as const, choiceId: 'c2' },
    ]
    expect(responses.map(r => scoreStrikeInteraction(scenario, r).correct)).toEqual([false, false, false, false, false])
    expect(scoreStrikeInteraction(scenario, { kind: 'scenario', choiceId: 'c1' }).correct).toBe(true)
  })
})

describe('isStrikeCompletionCurrent', () => {
  it('never counts a missing, expired, superseded or wrongly pinned pass as current', () => {
    const completedOptions = [null, 'not-a-date', '2026-01-01T00:00:00Z', NOW.toISOString(), '2027-01-01T00:00:00Z']
    const expiresOptions = [null, undefined, 'garbage', new Date(NOW.getTime() - 1).toISOString(), NOW.toISOString(), new Date(NOW.getTime() + DAY).toISOString()]
    const versionOptions = [null, 'v1', 'v2', 'v3', 'es2']
    const requiredOptions = [null, undefined, 'v1', 'v3']
    const lineages: (StrikeVersionLineage[] | undefined)[] = [
      undefined,
      [],
      [{ id: 'v1', versionNumber: 1, supersedesCompletions: false }, { id: 'v2', versionNumber: 2, supersedesCompletions: false }],
      [{ id: 'v1', versionNumber: 1, supersedesCompletions: false }, { id: 'v2', versionNumber: 2, supersedesCompletions: false }, { id: 'v3', versionNumber: 3, supersedesCompletions: true }],
      [{ id: 'v1', versionNumber: 1, supersedesCompletions: false }, { id: 'es2', versionNumber: 2, supersedesCompletions: false }],
    ]
    const violations: string[] = []
    let cases = 0
    for (const [completedAt, expiresAt, moduleVersionId, requiredVersionId, lineage] of cross(completedOptions, expiresOptions, versionOptions, requiredOptions, lineages)) {
      cases++
      const current = isStrikeCompletionCurrent({ completedAt, expiresAt, moduleVersionId, requiredVersionId, lineage, now: NOW })
      const where = JSON.stringify({ completedAt, expiresAt, moduleVersionId, requiredVersionId, lineage: lineage?.map(l => l.id) })
      if (!current) continue
      if (!completedAt || !Number.isFinite(new Date(completedAt).getTime())) violations.push(`current without a completion date: ${where}`)
      const exp = expiresAt ? new Date(expiresAt).getTime() : null
      if (exp !== null && Number.isFinite(exp) && exp < NOW.getTime()) violations.push(`expired but current: ${where}`)
      if (requiredVersionId && moduleVersionId && requiredVersionId !== moduleVersionId) violations.push(`pinned to another version but current: ${where}`)
      if (lineage) {
        const floor = strikeCompletionFloor(lineage)
        const v = lineage.find(l => l.id === moduleVersionId)
        if (floor > 1 && (!v || v.versionNumber < floor)) violations.push(`below the supersession floor but current: ${where}`)
      }
    }
    expect(violations.slice(0, 20)).toEqual([])
    expect(cases).toBe(5 * 6 * 5 * 4 * 5)
  })
})

describe('assignment standing and reminders', () => {
  it('gives every assignment exactly one sensible standing, hour by hour', () => {
    const startsOptions = [null, -30, -1, 0, 1, 30].map(d => (d === null ? null : new Date(NOW.getTime() + d * DAY).toISOString()))
    const dueHours = Array.from({ length: 24 * 21 + 1 }, (_, i) => i - 24 * 10)
    const violations: string[] = []
    let cases = 0
    for (const [startsAt, completed, hours] of cross(startsOptions, [false, true], [null, ...dueHours])) {
      cases++
      const dueAt = hours === null ? null : new Date(NOW.getTime() + hours * 3_600_000).toISOString()
      const s = assignmentStanding({ startsAt, dueAt, completed }, NOW)
      const where = `starts=${startsAt} due=${hours}h completed=${completed}`
      if (!['upcoming', 'open', 'due_soon', 'overdue', 'complete'].includes(s)) violations.push(`unknown standing ${s}: ${where}`)
      if (completed && s !== 'complete') violations.push(`completed but ${s}: ${where}`)
      if (!completed && s === 'complete') violations.push(`complete without completion: ${where}`)
      const unreleased = startsAt !== null && new Date(startsAt).getTime() > NOW.getTime()
      if (!completed && unreleased && s !== 'upcoming') violations.push(`unreleased but ${s}: ${where}`)
      if (!completed && !unreleased && hours !== null) {
        if (hours < 0 && s !== 'overdue') violations.push(`past due but ${s}: ${where}`)
        if (hours >= 0 && hours <= 72 && s !== 'due_soon') violations.push(`within 3 days but ${s}: ${where}`)
        if (hours > 72 && s !== 'open') violations.push(`far off but ${s}: ${where}`)
      }
    }
    expect(violations.slice(0, 20)).toEqual([])
    expect(cases).toBe(6 * 2 * (dueHours.length + 1))
  })

  it('sends at most the documented reminders over a 60-day run of daily crons', () => {
    const violations: string[] = []
    let cases = 0
    for (const dueOffsetHours of Array.from({ length: 48 }, (_, i) => i * 0.5)) {
      const due = new Date(NOW.getTime() + 30 * DAY + dueOffsetHours * 3_600_000)
      const sent: { day: number; kind: string }[] = []
      for (let day = 0; day <= 60; day++) {
        cases++
        const runAt = new Date(NOW.getTime() + day * DAY)
        const kind = strikeReminderFor(due, runAt)
        if (!kind) continue
        sent.push({ day, kind })
        const overdue = runAt.getTime() > due.getTime()
        if (kind === 'overdue' && !overdue) violations.push(`overdue reminder before due (offset ${dueOffsetHours}h, day ${day})`)
        if (kind === 'due_soon' && overdue) violations.push(`due-soon reminder after due (offset ${dueOffsetHours}h, day ${day})`)
      }
      const dueSoon = sent.filter(s => s.kind === 'due_soon').length
      if (dueSoon !== 2) violations.push(`expected 2 due-soon reminders, got ${dueSoon} (offset ${dueOffsetHours}h)`)
      const overdueDays = sent.filter(s => s.kind === 'overdue').map(s => s.day)
      if (overdueDays.some((d, i) => i > 0 && d - overdueDays[i - 1] !== 7)) violations.push(`overdue reminders not weekly (offset ${dueOffsetHours}h): ${overdueDays}`)
    }
    expect(violations.slice(0, 20)).toEqual([])
    expect(cases).toBe(48 * 61)
  })

  it('always schedules the next recurrence strictly after now, on the schedule anchor', () => {
    const rules: StrikeRecurrenceRule[] = [
      { freq: 'monthly', intervalDays: null, expiryDays: null },
      { freq: 'quarterly', intervalDays: null, expiryDays: null },
      { freq: 'semiannual', intervalDays: null, expiryDays: null },
      { freq: 'annual', intervalDays: null, expiryDays: null },
      { freq: 'interval', intervalDays: 1, expiryDays: null },
      { freq: 'interval', intervalDays: 45, expiryDays: 7 },
    ]
    const anchors = ['2024-01-31', '2024-02-29', '2025-03-31', '2025-08-30', '2026-12-31', '2026-06-15'].map(d => new Date(`${d}T09:00:00Z`))
    const nows = [-400, -1, 0, 1, 29, 31, 365, 1000].map(d => new Date(NOW.getTime() + d * DAY))
    const violations: string[] = []
    let cases = 0
    for (const [rule, previousDue, now] of cross(rules, anchors, nows)) {
      cases++
      const next = nextDueDate(rule, previousDue, now)
      const where = `${rule.freq}/${rule.intervalDays} from ${previousDue.toISOString()} at ${now.toISOString()}`
      if (!(next.getTime() > now.getTime())) violations.push(`not after now: ${where} → ${next.toISOString()}`)
      if (!(next.getTime() > previousDue.getTime())) violations.push(`not after the previous due date: ${where}`)
      if (rule.freq !== 'interval' && next.getUTCDate() > previousDue.getUTCDate()) violations.push(`drifted later in the month: ${where} → ${next.toISOString()}`)
      if (next.getUTCHours() !== previousDue.getUTCHours()) violations.push(`changed the time of day: ${where}`)
    }
    expect(violations.slice(0, 20)).toEqual([])
    expect(cases).toBe(6 * 6 * 8)
  })
})

describe('isStrikeAssignmentApplicable', () => {
  it('targets exactly the people an assignment names, for every target and identity', () => {
    const types = ['tenant', 'user', 'role', 'department', 'site', 'team', '']
    const targetIds = [null, '', 'u1', 'admin', 'Sanitation', ' sanitation ', 'Plant 2']
    const users = [null, 'u1', 'u2']
    const roles = [null, 'admin', 'member']
    const labels = [null, '', 'Sanitation', 'SANITATION', 'Plant 2']
    const violations: string[] = []
    let cases = 0
    for (const [targetType, targetId, userId, role, department, site] of cross(types, targetIds, users, roles, labels, labels)) {
      cases++
      const applies = isStrikeAssignmentApplicable({ targetType, targetId, userId, role, department, site })
      const where = JSON.stringify({ targetType, targetId, userId, role, department, site })
      const norm = (v: string | null) => (v ?? '').trim().toLowerCase()
      const expected =
        targetType === 'tenant' ? !targetId
        : targetType === 'user' ? !!userId && targetId === userId
        : targetType === 'role' ? !!role && targetId === role
        : targetType === 'department' ? !!norm(department) && !!norm(targetId) && norm(department) === norm(targetId)
        : targetType === 'site' ? !!norm(site) && !!norm(targetId) && norm(site) === norm(targetId)
        : false
      if (applies !== expected) violations.push(`${where} → ${applies}`)
    }
    expect(violations.slice(0, 20)).toEqual([])
    expect(cases).toBe(7 * 7 * 3 * 3 * 5 * 5)
  })
})

describe('pickStrikeLocale', () => {
  it('always returns a language the module has, honoring the learner when it can', () => {
    const all = ['en', 'es', 'fr', 'pt']
    const subsets = all.reduce<string[][]>((acc, l) => [...acc, ...acc.map(s => [...s, l])], [[]])
    const violations: string[] = []
    let cases = 0
    for (const [available, preferred] of cross(subsets, [null, undefined, '', 'en', 'es', 'de'])) {
      cases++
      const picked = pickStrikeLocale(available, preferred)
      const where = `${available.join(',')} pref=${preferred}`
      if (available.length === 0 ? picked !== null : !available.includes(picked as string)) violations.push(`not an available language: ${where} → ${picked}`)
      if (preferred && available.includes(preferred) && picked !== preferred) violations.push(`ignored the learner: ${where}`)
      if (!(preferred && available.includes(preferred)) && available.includes('en') && picked !== 'en') violations.push(`did not fall back to English: ${where}`)
    }
    expect(violations).toEqual([])
    expect(cases).toBe(16 * 6)
  })
})

describe('xpEventsForPass', () => {
  it('never awards the same ledger entry twice in one pass, and re-passing keys the same', () => {
    const violations: string[] = []
    let cases = 0
    for (const [solved, assignment, passedOffset] of cross(
      [[], ['i1'], ['i1', 'i1', 'i2'], ['i1', 'i2', 'i3', 'i4']],
      [null, { id: 'a1', dueAt: null }, { id: 'a1', dueAt: NOW.toISOString() }],
      [-DAY, 0, DAY],
    )) {
      cases++
      const ctx = { moduleId: 'm', versionId: 'v1', passedAt: new Date(NOW.getTime() + passedOffset), assignment, solvedBlockKeys: solved }
      const events = xpEventsForPass(ctx)
      const keys = events.map(e => `${e.eventType}|${e.dedupeKey}`)
      if (new Set(keys).size !== keys.length) violations.push(`duplicate ledger keys: ${keys}`)
      if (JSON.stringify(xpEventsForPass(ctx)) !== JSON.stringify(events)) violations.push('not deterministic')
      const onTime = events.some(e => e.eventType === 'on_time')
      const due = assignment?.dueAt ? new Date(assignment.dueAt).getTime() : null
      if (onTime !== (due !== null && ctx.passedAt.getTime() <= due)) violations.push(`on-time bonus wrong: due=${assignment?.dueAt} passed=${ctx.passedAt.toISOString()}`)
      if (events.some(e => e.points <= 0)) violations.push('non-positive points')
    }
    expect(violations).toEqual([])
    expect(cases).toBe(4 * 3 * 3)
  })
})

describe('summarizeMicrolearning', () => {
  function dataset(seed: number): MicrolearningInput {
    const rand = seeded(seed)
    const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)]
    const modules = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, i) => ({ id: `mod${i}`, title: `Module ${i}` }))
    const versions = modules.flatMap((m, i) => [
      { id: `${m.id}-en`, moduleId: m.id, locale: 'en', versionNumber: 1, supersedesCompletions: false },
      ...(i % 2 === 0 ? [{ id: `${m.id}-es`, moduleId: m.id, locale: 'es', versionNumber: 2, supersedesCompletions: false }] : []),
    ])
    const members = Array.from({ length: Math.floor(rand() * 12) }, (_, i) => ({
      id: `m${i}`, displayName: `M${i}`, profileId: rand() < 0.5 ? `u${i}` : null, role: pick([null, 'member', 'admin']),
      department: pick([null, 'A', 'B']), site: null,
    }))
    const learner = () => {
      const i = Math.floor(rand() * 15)
      const member = members[i]
      // Account learners can appear with only a user id; kiosk learners with only a member id.
      return rand() < 0.3 && member?.profileId ? { memberId: null, userId: member.profileId } : { memberId: member ? member.id : `ghost${i}`, userId: null }
    }
    const when = () => new Date(NOW.getTime() - Math.floor(rand() * 120) * DAY - Math.floor(rand() * DAY)).toISOString()
    const completions = Array.from({ length: Math.floor(rand() * 40) }, () => {
      const v = pick(versions)
      const completedAt = when()
      return {
        moduleId: v.moduleId, moduleVersionId: v.id, ...learner(), completedAt,
        expiresAt: pick([null, new Date(new Date(completedAt).getTime() + pick([30, 90, 365]) * DAY).toISOString()]),
        assisted: rand() < 0.2,
      }
    })
    const attempts = Array.from({ length: Math.floor(rand() * 50) }, () => ({
      moduleId: pick(modules).id, ...learner(), submittedAt: when(), passed: rand() < 0.7, scorePercent: pick([null, 0, 40, 80, 100]),
    }))
    return {
      windowDays: pick([7, 30, 90]),
      now: NOW,
      modules, versions, completions, attempts,
      practice: Array.from({ length: Math.floor(rand() * 20) }, () => ({ correct: rand() < 0.6, hintsUsed: pick([0, 0, 1, 2]) })),
      members,
      assignments: Array.from({ length: Math.floor(rand() * 4) }, (_, i) => ({
        id: `a${i}`, moduleId: pick(modules).id, targetType: pick(['tenant', 'department', 'role']), targetId: pick([null, 'A', 'member']),
        startsAt: pick([null, new Date(NOW.getTime() + 5 * DAY).toISOString()]), dueAt: pick([null, new Date(NOW.getTime() + pick([-5, 2, 20]) * DAY).toISOString()]),
      })),
      permitOverrideWorkers: Math.floor(rand() * 3),
    }
  }

  it('keeps every total consistent across 2000 generated tenants', () => {
    const violations: string[] = []
    const check = (seed: number, ok: boolean, what: string) => { if (!ok) violations.push(`seed ${seed}: ${what}`) }
    for (let seed = 1; seed <= 2000; seed++) {
      const input = dataset(seed)
      const s = summarizeMicrolearning(input)
      const rates = [s.workforceTrained, s.passRate, s.firstTryPassRate, s.practice.solvedFirstTry, s.practice.usedHint, ...s.modules.map(m => m.passRate)]
      for (const r of rates) {
        check(seed, r.numerator >= 0 && r.numerator <= r.denominator, 'rate numerator outside 0..denominator')
        check(seed, r.percent === null ? r.denominator === 0 : r.percent >= 0 && r.percent <= 100, 'rate percent out of range')
      }
      check(seed, s.modules.reduce((n, m) => n + m.completions, 0) === s.completions, 'module completions do not add up')
      check(seed, s.languages.reduce((n, l) => n + l.completions, 0) === s.completions, 'language split does not add up')
      check(seed, s.delivery.standard + s.delivery.assisted === s.completions, 'delivery split does not add up')
      check(seed, s.trend.points.reduce((n, p) => n + p.completions, 0) === s.completions, 'trend does not add up')
      check(seed, s.learners <= s.completions, 'more learners than completions')
      check(seed, s.modules.every(m => m.learners <= m.completions && m.assisted <= m.completions), 'module learners/assisted exceed completions')
      check(seed, s.workforceTrained.denominator === input.members.length, 'workforce denominator is not the roster')
      check(seed, s.compliance.complete <= s.compliance.assigned, 'more complete than assigned')
      check(seed, s.compliance.overdue + s.compliance.dueSoon <= s.compliance.assigned, 'overdue + due soon exceed assigned')
      const scores = input.attempts.filter(a => {
        const t = new Date(a.submittedAt).getTime()
        return t >= new Date(NOW.toISOString().slice(0, 10)).getTime() - (s.windowDays - 1) * DAY && t <= NOW.getTime() && a.scorePercent !== null
      }).map(a => a.scorePercent as number)
      check(seed, scores.length === 0 ? s.averageScore === null : s.averageScore !== null && s.averageScore >= Math.min(...scores) && s.averageScore <= Math.max(...scores), 'average score outside the scores it averages')
      check(seed, s.passRate.denominator === input.attempts.filter(a => {
        const t = new Date(a.submittedAt).getTime()
        return t >= new Date(NOW.toISOString().slice(0, 10)).getTime() - (s.windowDays - 1) * DAY && t <= NOW.getTime()
      }).length, 'pass rate does not cover exactly the window\'s attempts')
      check(seed, JSON.stringify(summarizeMicrolearning(input)) === JSON.stringify(s), 'not deterministic')
    }
    expect(violations.slice(0, 20)).toEqual([])
  })
})
