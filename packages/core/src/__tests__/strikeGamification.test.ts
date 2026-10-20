import { describe, expect, it } from 'vitest'
import {
  curriculumCompleteEvent,
  deriveBadges,
  privateRank,
  rankTeams,
  totalXp,
  xpEventsForPass,
  type StrikeLedgerRow,
} from '../strikeGamification'

describe('xpEventsForPass', () => {
  const base = { moduleId: 'loto', versionId: 'v1', passedAt: new Date('2026-11-10T12:00:00Z'), assignment: null, solvedBlockKeys: [] }

  it('awards a pass keyed to the version, so re-passing earns nothing new', () => {
    expect(xpEventsForPass(base)).toEqual([{ eventType: 'module_passed', dedupeKey: 'version:v1', points: 100, moduleId: 'loto' }])
  })

  it('adds on-time credit only when passed by the due date', () => {
    const onTime = xpEventsForPass({ ...base, assignment: { id: 'a1', dueAt: '2026-11-11T00:00:00Z' } })
    const late = xpEventsForPass({ ...base, assignment: { id: 'a1', dueAt: '2026-11-09T00:00:00Z' } })
    expect(onTime.map(e => e.eventType)).toEqual(['module_passed', 'on_time'])
    expect(late.map(e => e.eventType)).toEqual(['module_passed'])
  })

  it('scopes on-time credit to the due date, so a recurring assignment can earn it each cycle', () => {
    const q1 = xpEventsForPass({ ...base, assignment: { id: 'a1', dueAt: '2026-11-11T00:00:00Z' } })[1]
    const q2 = xpEventsForPass({ ...base, passedAt: new Date('2027-02-01T00:00:00Z'), assignment: { id: 'a1', dueAt: '2027-02-11T00:00:00Z' } })[1]
    expect(q1.dedupeKey).not.toBe(q2.dedupeKey)
  })

  it('credits each solved practice block once', () => {
    const events = xpEventsForPass({ ...base, solvedBlockKeys: ['sort', 'sort', 'hotspot'] })
    expect(events.filter(e => e.eventType === 'practice_solved').map(e => e.dedupeKey)).toEqual(['version:v1:block:sort', 'version:v1:block:hotspot'])
  })

  it('never depends on score or speed: the inputs have neither', () => {
    expect(Object.keys(base).sort()).toEqual(['assignment', 'moduleId', 'passedAt', 'solvedBlockKeys', 'versionId'])
  })
})

describe('deriveBadges', () => {
  const pass = (moduleId: string): StrikeLedgerRow => ({ eventType: 'module_passed', points: 100, moduleId })

  it('derives badges from the ledger', () => {
    const rows: StrikeLedgerRow[] = [
      pass('loto'), pass('cse'), pass('heights'), pass('hazcom'), pass('ppe'),
      { eventType: 'on_time', points: 25, moduleId: 'loto' },
      { eventType: 'on_time', points: 25, moduleId: 'cse' },
      { eventType: 'on_time', points: 25, moduleId: 'heights' },
      { ...curriculumCompleteEvent('c1'), moduleId: null },
    ]
    expect(deriveBadges(rows, new Set(['loto'])).map(b => b.id))
      .toEqual(['first_module', 'loto_ready', 'on_time_finisher', 'curriculum_complete', 'safety_scholar'])
  })

  it('earns nothing from an empty ledger', () => {
    expect(deriveBadges([], new Set(['loto']))).toEqual([])
    expect(totalXp([])).toBe(0)
  })
})

describe('leaderboards', () => {
  it('ranks teams per member and hides teams too small to be anonymous', () => {
    const rows = [
      ...Array.from({ length: 4 }, () => ({ team: 'Sanitation', xp: 300 })),
      ...Array.from({ length: 10 }, () => ({ team: 'Packaging', xp: 200 })),
      { team: 'Maintenance', xp: 900 }, { team: 'Maintenance', xp: 900 },
      { team: null, xp: 1000 },
    ]
    expect(rankTeams(rows)).toEqual([
      { team: 'Sanitation', members: 4, xpPerMember: 300 },
      { team: 'Packaging', members: 10, xpPerMember: 200 },
    ])
  })

  it('gives a private rank with ties sharing a place', () => {
    expect(privateRank(200, [500, 200, 200, 100])).toEqual({ rank: 2, of: 4 })
    expect(privateRank(0, [])).toEqual({ rank: 1, of: 1 })
  })
})
