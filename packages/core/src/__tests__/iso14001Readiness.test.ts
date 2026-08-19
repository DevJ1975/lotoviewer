import { describe, it, expect } from 'vitest'
import {
  assessIso14001,
  assertClauseCoverage,
  CORE_CLAUSES,
  READINESS_WINDOWS,
  type ReadinessSignals,
  type ClauseVerdict,
} from '../iso14001Readiness'
import { ISO14001_CLAUSE_MAP } from '../iso14001'

// A tenant with a mature, fully-evidenced EMS. Every test below starts
// here and breaks exactly one thing, so a failure names its own cause.
function healthy(): ReadinessSignals {
  return {
    disabledModules: [],

    risks:                 { count: 12, ageDays: 30 },
    documentsRegisterLive: true,
    policyApproved:        true,
    policyReviewOverdue:   false,
    requiredDocsMissing:   0,
    docsReviewOverdue:     0,
    risksWithoutControls:  0,
    aspectsTotal:          14,
    aspectsSignificant:    5,
    significantUncontrolled: 0,
    aspectsRegisterAgeDays: 20,
    obligationsTotal:      6,
    obligationsOverdue:    0,
    complianceEvalAgeDays: 60,
    significantUnaddressed: 0,
    objectivesActive:      6,
    objectivesLinked:      6,
    objectivesWithTargets: 6,
    objectivesAchieved:    2,
    trainingRecords:       40,
    trainingExpired:       0,
    trainingExpiringSoon:  0,
    awarenessAgeDays:      45,
    communicationAgeDays:  45,
    operationalInspections: 22,
    operationalOverdue:     0,
    emergencyDrillAgeDays: 120,
    objectivesStaleReadings: 0,
    auditProgrammeLive:    true,
    lastAuditAgeDays:      90,
    auditClausesUncovered: 0,
    lastReviewAgeDays:     120,
    lastReviewHasOutputs:  true,
    nonconformityRegisterLive: true,
    openMajorNonconformities:  0,
    overdueActions:            0,
    closedWithoutVerification: 0,
    improvementsThisPeriod: 4,
  }
}

function verdictFor(code: string, patch: Partial<ReadinessSignals>): ClauseVerdict {
  const card = assessIso14001({ ...healthy(), ...patch })
  const clause = card.clauses.find(c => c.code === code)
  if (!clause) throw new Error(`clause ${code} was not assessed`)
  return clause.verdict
}

describe('assessIso14001 — contract with the clause map', () => {
  it('assesses exactly the clauses ISO14001_CLAUSE_MAP declares', () => {
    const codes = assessIso14001(healthy()).clauses.map(c => c.code)
    // Throws with a diff if the two ever drift apart.
    expect(() => assertClauseCoverage(codes)).not.toThrow()
    expect(codes).toHaveLength(ISO14001_CLAUSE_MAP.length)
  })

  it('carries the title through from the clause map', () => {
    const card = assessIso14001(healthy())
    const aspects = card.clauses.find(c => c.code === '6.1.2')!
    expect(aspects.title).toBe('Environmental aspects')
  })
})

describe('assessIso14001 — a fully evidenced EMS', () => {
  it('reports every clause conforming at 100% coverage', () => {
    const card = assessIso14001(healthy())
    const notConforming = card.clauses.filter(c => c.verdict !== 'conforming')
    expect(notConforming.map(c => `${c.code}: ${c.reason}`)).toEqual([])
    expect(card.coverage).toBe(100)
    expect(card.band).toBe('ready')
    expect(card.blockers).toEqual([])
  })
})

// One table per clause: the signal that breaks it, and the verdict that
// should result. Table-driven so adding a clause means adding a row.
describe('assessIso14001 — per-clause verdicts', () => {
  const cases: Array<[string, ClauseVerdict, Partial<ReadinessSignals>, string]> = [
    ['4.1',   'gap',       { risks: { count: 0, ageDays: null } },        'no risk entries'],
    ['4.1',   'attention', { risks: { count: 5, ageDays: 400 } },         'register over a year stale'],
    ['5.2',   'gap',       { policyApproved: false },                     'no approved policy'],
    ['5.2',   'attention', { policyReviewOverdue: true },                 'policy past review'],
    ['6.1.1', 'attention', { risksWithoutControls: 3 },                   'uncontrolled risks'],
    ['6.1.2', 'gap',       { aspectsTotal: 0, aspectsSignificant: 0 },    'empty aspects register'],
    ['6.1.2', 'attention', { significantUncontrolled: 2 },                'uncontrolled significant aspects'],
    ['6.1.2', 'attention', { aspectsRegisterAgeDays: 400 },               'stale aspects register'],
    ['6.1.3', 'gap',       { obligationsTotal: 0 },                       'no obligations'],
    ['6.1.3', 'attention', { obligationsOverdue: 1 },                     'overdue obligation'],
    ['6.1.4', 'attention', { significantUnaddressed: 1 },                 'unaddressed significant aspect'],
    ['6.2.1', 'gap',       { objectivesActive: 0 },                       'no objectives'],
    ['6.2.1', 'attention', { objectivesWithTargets: 4 },                  'objectives without targets'],
    ['7.2',   'gap',       { trainingRecords: 0 },                        'no training records'],
    ['7.2',   'attention', { trainingExpired: 2 },                        'expired training'],
    ['7.3',   'gap',       { awarenessAgeDays: null },                    'awareness never communicated'],
    ['7.4',   'attention', { communicationAgeDays: 400 },                 'stale communication'],
    ['7.5',   'gap',       { requiredDocsMissing: 1 },                    'required document absent'],
    ['7.5',   'attention', { docsReviewOverdue: 2 },                      'documents past review'],
    ['8.1',   'gap',       { operationalInspections: 0 },                 'no operational checks'],
    ['8.2',   'attention', { emergencyDrillAgeDays: 400 },                'stale emergency drill'],
    ['9.1.1', 'attention', { objectivesStaleReadings: 1 },                'stale objective reading'],
    ['9.1.2', 'gap',       { complianceEvalAgeDays: null },               'never evaluated compliance'],
    ['9.2',   'gap',       { lastAuditAgeDays: null },                    'no internal audit'],
    ['9.2',   'attention', { auditClausesUncovered: 3 },                  'incomplete clause coverage'],
    ['9.3',   'gap',       { lastReviewAgeDays: null },                   'no management review'],
    ['9.3',   'attention', { lastReviewHasOutputs: false },               'review without outputs'],
    ['10.2',  'gap',       { nonconformityRegisterLive: false },          'no NC register'],
    ['10.2',  'attention', { overdueActions: 2 },                         'overdue corrective actions'],
    ['10.3',  'attention', { improvementsThisPeriod: 0 },                 'no verified closures'],
  ]

  it.each(cases)('clause %s reads %s when there is %s', (code, expected, patch) => {
    expect(verdictFor(code, patch)).toBe(expected)
  })

  it('treats a reading exactly at the window boundary as still current', () => {
    expect(verdictFor('9.3', { lastReviewAgeDays: READINESS_WINDOWS.annualReviewDays })).toBe('conforming')
    expect(verdictFor('9.3', { lastReviewAgeDays: READINESS_WINDOWS.annualReviewDays + 1 })).toBe('attention')
  })
})

describe('assessIso14001 — not_applicable', () => {
  it('excludes a clause whose contributing module is off', () => {
    const card = assessIso14001({ ...healthy(), disabledModules: ['loto'], trainingRecords: 0 })
    const competence = card.clauses.find(c => c.code === '7.2')!
    expect(competence.verdict).toBe('not_applicable')
    // The whole point: a module the tenant never bought must not drag
    // the score down, so it leaves the denominator entirely.
    expect(card.coverage).toBe(100)
    expect(card.counts.not_applicable).toBe(1)
  })

  it('does not count a disabled module as conforming either', () => {
    const card = assessIso14001({ ...healthy(), disabledModules: ['loto'] })
    expect(card.counts.conforming).toBe(ISO14001_CLAUSE_MAP.length - 1)
  })
})

describe('assessIso14001 — blocking findings', () => {
  it('marks a gap on a core clause as blocking', () => {
    const card = assessIso14001({ ...healthy(), aspectsTotal: 0, aspectsSignificant: 0 })
    expect(card.clauses.find(c => c.code === '6.1.2')!.blocking).toBe(true)
    expect(card.band).toBe('not_ready')
    expect(card.headline).toContain('6.1.2')
  })

  it('does not mark a gap on a non-core clause as blocking', () => {
    const card = assessIso14001({ ...healthy(), awarenessAgeDays: null })
    expect(card.clauses.find(c => c.code === '7.3')!.blocking).toBe(false)
    expect(card.band).toBe('ready_with_gaps')
  })

  it('every CORE_CLAUSES code exists in the clause map', () => {
    const mapped = new Set(ISO14001_CLAUSE_MAP.map(c => c.code))
    expect(CORE_CLAUSES.filter(c => !mapped.has(c))).toEqual([])
  })

  it('an open major forces not_ready even at high coverage', () => {
    // This is the auditor's objection made executable: everything else
    // is green, coverage is high, and the verdict is still Not ready.
    const card = assessIso14001({ ...healthy(), openMajorNonconformities: 1 })
    expect(card.coverage).toBeGreaterThanOrEqual(90)
    expect(card.band).toBe('not_ready')
    expect(card.headline).toContain('open major')
  })

  it('pluralises the open-major headline correctly', () => {
    expect(assessIso14001({ ...healthy(), openMajorNonconformities: 1 }).headline)
      .toContain('1 open major nonconformity')
    expect(assessIso14001({ ...healthy(), openMajorNonconformities: 3 }).headline)
      .toContain('3 open major nonconformities')
  })
})

describe('assessIso14001 — coverage arithmetic', () => {
  it('rounds coverage to a whole percent of applicable clauses', () => {
    const card = assessIso14001({ ...healthy(), awarenessAgeDays: null, communicationAgeDays: null })
    const applicable = card.clauses.length - card.counts.not_applicable
    expect(card.coverage).toBe(Math.round((card.counts.conforming / applicable) * 100))
    expect(card.coverage).toBeLessThan(100)
  })

  it('counts sum to the number of clauses assessed', () => {
    const card = assessIso14001({ ...healthy(), disabledModules: ['loto'] })
    const total = card.counts.conforming + card.counts.attention
      + card.counts.gap + card.counts.not_applicable
    expect(total).toBe(card.clauses.length)
  })
})

describe('assessIso14001 — phase-3/4 tables absent', () => {
  // The report card ships before the documents register and the audit
  // programme exist. It must say so honestly rather than blaming the
  // tenant for records they were never given a place to keep.
  const preRelease: ReadinessSignals = {
    ...healthy(),
    documentsRegisterLive: false,
    auditProgrammeLive:    false,
  }

  it('reports 7.5 and 9.2 as gaps naming the missing feature', () => {
    const card = assessIso14001(preRelease)
    const docs  = card.clauses.find(c => c.code === '7.5')!
    const audit = card.clauses.find(c => c.code === '9.2')!
    expect(docs.verdict).toBe('gap')
    expect(docs.reason).toContain('No controlled-document register yet')
    expect(audit.verdict).toBe('gap')
    expect(audit.reason).toContain('No internal-audit programme yet')
  })

  it('offers no fix link for a feature that does not exist yet', () => {
    const card = assessIso14001(preRelease)
    expect(card.clauses.find(c => c.code === '7.5')!.fixHref).toBeNull()
    expect(card.clauses.find(c => c.code === '9.2')!.fixHref).toBeNull()
  })

  it('still gives every other clause a working fix link', () => {
    const card = assessIso14001(preRelease)
    const broken = card.clauses
      .filter(c => c.verdict !== 'conforming' && c.verdict !== 'not_applicable')
      .filter(c => !['7.5', '9.2', '5.2'].includes(c.code))
      .filter(c => c.fixHref === null)
    expect(broken.map(c => c.code)).toEqual([])
  })
})

describe('assessIso14001 — the WLS demo seed story', () => {
  // Migration 256 (seed_wls_iso14001_demo) tunes its data to produce a
  // specific mixed report card, and its header comment documents that
  // outcome. This fixture mirrors the signals that seed produces, so the
  // claims in the migration header are checked rather than trusted. If
  // the seed or the scoring rules change, this test says so.
  const demo: ReadinessSignals = {
    ...healthy(),
    // Phases 3 and 4 have not shipped, so the demo cannot seed them.
    documentsRegisterLive: false,
    auditProgrammeLive:    false,
    // 14 aspects, 5 significant, 1 of those (bulk diesel) uncontrolled
    // and with no objective.
    aspectsTotal:            14,
    aspectsSignificant:      5,
    significantUncontrolled: 1,
    significantUnaddressed:  1,
    // 6 obligations, the stormwater annual report already overdue.
    obligationsTotal:   6,
    obligationsOverdue: 1,
    // 6 objectives, all measurable and linked; the energy objective's
    // only reading is older than the 90-day monitoring window.
    objectivesActive:        6,
    objectivesLinked:        6,
    objectivesWithTargets:   6,
    objectivesAchieved:      1,
    objectivesStaleReadings: 1,
    // One open major — the whole point of the demo.
    openMajorNonconformities: 1,
    overdueActions:           2,
    // Management review four months ago, with recorded outputs.
    lastReviewAgeDays:    120,
    lastReviewHasOutputs: true,
    // Nothing in the platform stores an emergency drill or test, so the
    // fetcher reports null and 8.2 reads as a gap. Mirrored here rather
    // than inherited from healthy(), which would let the test claim a
    // record the demo cannot actually produce.
    emergencyDrillAgeDays: null,
  }

  const verdicts = () => {
    const card = assessIso14001(demo)
    return Object.fromEntries(card.clauses.map(c => [c.code, c.verdict]))
  }

  it('produces the mixed picture the migration header documents', () => {
    expect(verdicts()).toMatchObject({
      '6.1.2': 'attention',    // uncontrolled significant aspect
      '6.1.3': 'attention',    // overdue obligation
      '6.1.4': 'attention',    // unaddressed significant aspect
      '6.2.1': 'conforming',   // every objective measurable and linked
      '9.1.1': 'attention',    // stale reading on the energy objective
      '9.3':   'conforming',   // review within a year, outputs recorded
      '10.2':  'attention',    // open major + overdue actions
      '10.3':  'conforming',   // verified actions this period
      '5.2':   'gap',          // no documents register yet (phase 3)
      '7.5':   'gap',          // no documents register yet (phase 3)
      '9.2':   'gap',          // no audit programme yet (phase 4)
    })
  })

  it('lands on Not ready, driven by the open major rather than coverage', () => {
    const card = assessIso14001(demo)
    expect(card.band).toBe('not_ready')
    expect(card.headline).toContain('1 open major nonconformity')
    // Coverage is respectable — which is exactly why it must not be the
    // headline. A demo that showed "68%" and nothing else would teach
    // the buyer the wrong thing about how audits work.
    expect(card.coverage).toBeGreaterThan(30)
  })

  it('shows every verdict type, so the demo exercises the whole UI', () => {
    const card = assessIso14001(demo)
    expect(card.counts.conforming).toBeGreaterThan(0)
    expect(card.counts.attention).toBeGreaterThan(0)
    expect(card.counts.gap).toBeGreaterThan(0)
  })

  it('matches the figures migration 256 documents in its header', () => {
    // The migration's header comment quotes these numbers to explain what
    // the demo will look like. Pinning them here means a change to the
    // seed or the scoring rules fails a test instead of quietly turning
    // that comment into a lie.
    const card = assessIso14001(demo)
    expect(card.counts).toEqual({
      conforming: 10, attention: 5, gap: 4, not_applicable: 0,
    })
    expect(card.coverage).toBe(53)
    expect(card.headline).toBe(
      'Not ready for a certification audit — 1 open major nonconformity; '
      + 'no evidence for clauses 7.5, 9.2.',
    )
  })
})
