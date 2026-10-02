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
    contextIssuesActive:        8,
    contextIssuesReviewOverdue: 0,
    climateIssueRecorded:       true,
    interestedPartiesActive:        5,
    interestedPartiesReviewOverdue: 0,
    scopeOnFile:           true,
    scopeReviewOverdue:    false,
    scopeStatesControlAndInfluence: true,
    policyApproved:        true,
    policyReviewOverdue:   false,
    policySignatoryStale:  false,
    policyCommunicatedInternally: true,
    rolesUnassigned:       0,
    processesUnassigned:   0,
    risks:                 { count: 12, ageDays: 30 },
    documentsRegisterLive: true,
    requiredDocsMissing:   0,
    docsReviewOverdue:     0,
    risksWithoutControls:  0,
    aspectsTotal:          14,
    aspectsSignificant:    5,
    significantUncontrolled: 0,
    aspectsUnscored:       0,
    aspectsControlUndetermined: 0,
    aspectsReviewOverdue:  0,
    obligationsTotal:      6,
    obligationsOverdue:    0,
    obligationsReviewOverdue: 0,
    complianceEvalAgeDays: 60,
    evaluationsOverdue:    0,
    obligationsUnscheduled:  0,
    evaluationsUndetermined: 0,
    significantUnaddressed: 0,
    objectivesActive:      6,
    objectivesLinked:      6,
    objectivesWithTargets: 6,
    objectivesAchieved:    2,
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

// The clauses with no environmental source in the platform yet.
const NOT_ASSESSED = ['7.2', '7.3', '7.4', '8.1', '8.2']

describe('assessIso14001 — a fully evidenced EMS', () => {
  it('reports every clause it can assess as conforming, and the rest as not assessed', () => {
    const card = assessIso14001(healthy())
    const notConforming = card.clauses.filter(c => c.verdict !== 'conforming')
    expect(notConforming.map(c => `${c.code}: ${c.verdict}`))
      .toEqual(NOT_ASSESSED.map(code => `${code}: not_assessed`))
    expect(card.blockers).toEqual([])
  })

  it('stops short of Ready while any clause is not assessed, and names them', () => {
    const card = assessIso14001(healthy())
    expect(card.band).toBe('ready_with_gaps')
    expect(card.headline).toBe(
      'Every clause the platform can assess has current evidence. '
      + 'Check 7.2, 7.3, 7.4, 8.1, 8.2 against your own records before an audit.',
    )
  })

  it('keeps not-assessed clauses in the coverage denominator', () => {
    const card = assessIso14001(healthy())
    const assessable = ISO14001_CLAUSE_MAP.length - NOT_ASSESSED.length
    expect(card.coverage).toBe(Math.round((assessable / ISO14001_CLAUSE_MAP.length) * 100))
  })
})

describe('assessIso14001 — clauses with no environmental source', () => {
  // These clauses used to read LOTO training, toolbox talks, Prop 65
  // notices and any inspection. Safety records are not environmental
  // evidence, so the card must not grade from them.
  it.each(NOT_ASSESSED)('grades %s not assessed, never blocking, with no fix link', code => {
    const clause = assessIso14001(healthy()).clauses.find(c => c.code === code)!
    expect(clause.verdict).toBe('not_assessed')
    expect(clause.blocking).toBe(false)
    expect(clause.fixHref).toBeNull()
    expect(clause.reason).toMatch(/^Not assessed: the platform/)
  })

  it('says why safety training does not count for competence', () => {
    const competence = assessIso14001(healthy()).clauses.find(c => c.code === '7.2')!
    expect(competence.reason).toContain('safety training is not evidence')
  })
})

// One table per clause: the signal that breaks it, and the verdict that
// should result. Table-driven so adding a clause means adding a row.
describe('assessIso14001 — per-clause verdicts', () => {
  const cases: Array<[string, ClauseVerdict, Partial<ReadinessSignals>, string]> = [
    ['4.1',   'gap',       { contextIssuesActive: 0 },                    'no context issues'],
    ['4.1',   'attention', { climateIssueRecorded: false },               'no climate-change determination'],
    ['4.1',   'attention', { contextIssuesReviewOverdue: 2 },             'context issues past review'],
    ['4.2',   'gap',       { interestedPartiesActive: 0 },                'no interested parties'],
    ['4.2',   'attention', { interestedPartiesReviewOverdue: 1 },         'interested party past review'],
    ['4.3',   'gap',       { scopeOnFile: false },                        'no documented scope'],
    ['4.3',   'attention', { scopeReviewOverdue: true },                  'scope past review'],
    ['4.3',   'attention', { scopeStatesControlAndInfluence: false },     'a scope silent on control and influence'],
    ['5.2',   'gap',       { policyApproved: false },                     'no signed, complete policy'],
    ['5.2',   'attention', { policySignatoryStale: true },                'policy signed by a prior owner'],
    ['5.2',   'attention', { policyCommunicatedInternally: false },       'a policy never communicated internally'],
    ['5.2',   'attention', { policyReviewOverdue: true },                 'policy past review'],
    ['5.3',   'gap',       { rolesUnassigned: 1 },                        'a clause 5.3 role with no one'],
    ['5.3',   'attention', { processesUnassigned: 3 },                    'processes with no owner'],
    ['6.1.1', 'attention', { risksWithoutControls: 3 },                   'uncontrolled risks'],
    ['6.1.2', 'gap',       { aspectsTotal: 0, aspectsSignificant: 0 },    'empty aspects register'],
    ['6.1.2', 'attention', { significantUncontrolled: 2 },                'uncontrolled significant aspects'],
    ['6.1.2', 'attention', { aspectsUnscored: 1 },                        'an unscored aspect'],
    ['6.1.2', 'attention', { aspectsControlUndetermined: 2 },             'aspects not marked control or influence'],
    ['6.1.2', 'attention', { aspectsReviewOverdue: 3 },                   'aspects past review'],
    ['6.1.3', 'gap',       { obligationsTotal: 0 },                       'no obligations'],
    ['6.1.3', 'attention', { obligationsOverdue: 1 },                     'overdue obligation'],
    ['6.1.3', 'attention', { obligationsReviewOverdue: 1 },               'obligation past register review'],
    ['6.1.4', 'attention', { significantUnaddressed: 1 },                 'unaddressed significant aspect'],
    ['6.2.1', 'gap',       { objectivesActive: 0 },                       'no objectives'],
    ['6.2.1', 'attention', { objectivesWithTargets: 4 },                  'objectives without targets'],
    ['7.5',   'gap',       { requiredDocsMissing: 1 },                    'required document absent'],
    ['7.5',   'attention', { docsReviewOverdue: 2 },                      'documents past review'],
    ['9.1.1', 'attention', { objectivesStaleReadings: 1 },                'stale objective reading'],
    ['9.1.2', 'gap',       { complianceEvalAgeDays: null },               'never evaluated compliance'],
    ['9.1.2', 'attention', { evaluationsOverdue: 2 },                     'evaluations past due'],
    ['9.1.2', 'attention', { complianceEvalAgeDays: 400 },                'no evaluation in over a year'],
    ['9.1.2', 'attention', { evaluationsUndetermined: 1 },                'a compliance status left undetermined'],
    ['9.1.2', 'attention', { obligationsUnscheduled: 1 },                 'an obligation with no evaluation frequency'],
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

  it('words each new Phase 1.1 finding the way an auditor would read it', () => {
    const reason = (code: string, patch: Partial<ReadinessSignals>) =>
      assessIso14001({ ...healthy(), ...patch }).clauses.find(c => c.code === code)!.reason
    expect(reason('6.1.2', { aspectsControlUndetermined: 1 }))
      .toBe('1 aspect does not record whether the organization controls it or can only influence it.')
    expect(reason('6.1.2', { aspectsControlUndetermined: 3 }))
      .toBe('3 aspects do not record whether the organization controls them or can only influence them.')
    expect(reason('5.3', { processesUnassigned: 1 })).toBe('1 EMS process has no owner.')
    expect(reason('4.3', { scopeStatesControlAndInfluence: false })).toContain('(4.3 e)')
  })

  it('treats a reading exactly at the window boundary as still current', () => {
    expect(verdictFor('9.3', { lastReviewAgeDays: READINESS_WINDOWS.annualReviewDays })).toBe('conforming')
    expect(verdictFor('9.3', { lastReviewAgeDays: READINESS_WINDOWS.annualReviewDays + 1 })).toBe('attention')
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
    const card = assessIso14001({ ...healthy(), objectivesActive: 0 })
    expect(card.clauses.find(c => c.code === '6.2.1')!.blocking).toBe(false)
    expect(card.band).toBe('ready_with_gaps')
    expect(card.headline).toBe('Evidence is in place, with clauses needing attention before an audit.')
  })

  it('every CORE_CLAUSES code exists in the clause map', () => {
    const mapped = new Set(ISO14001_CLAUSE_MAP.map(c => c.code))
    expect(CORE_CLAUSES.filter(c => !mapped.has(c))).toEqual([])
  })

  it('an open major forces not_ready even when everything else is green', () => {
    // This is the auditor's objection made executable: every other clause
    // the platform can assess conforms, and the verdict is still Not ready.
    const card = assessIso14001({ ...healthy(), openMajorNonconformities: 1 })
    expect(card.counts.conforming).toBe(assessIso14001(healthy()).counts.conforming - 1)
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
  it('rounds coverage to a whole percent of every clause', () => {
    const card = assessIso14001({ ...healthy(), objectivesActive: 0 })
    expect(card.coverage).toBe(Math.round((card.counts.conforming / card.clauses.length) * 100))
  })

  it('counts sum to the number of clauses assessed', () => {
    const card = assessIso14001({ ...healthy(), contextIssuesActive: 0, obligationsOverdue: 1 })
    const total = card.counts.conforming + card.counts.attention
      + card.counts.gap + card.counts.not_assessed
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
      .filter(c => c.verdict !== 'conforming' && c.verdict !== 'not_assessed')
      .filter(c => !['7.5', '9.2'].includes(c.code))
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
    // The WLS seed predates the context, scope and policy registers and
    // the evaluation record (Phase 1), and seeds none of them.
    contextIssuesActive:     0,
    climateIssueRecorded:    false,
    interestedPartiesActive: 0,
    scopeOnFile:             false,
    scopeStatesControlAndInfluence: false,
    policyApproved:          false,
    policyCommunicatedInternally: false,
    complianceEvalAgeDays:   null,
    // Nor responsibilities (Phase 1.1), and its aspects predate control
    // and influence, so all 14 are undecided.
    rolesUnassigned:            2,
    processesUnassigned:        14,
    aspectsControlUndetermined: 14,
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
    // Three actions are past due in the seeded data: both of the open
    // ones on the major, plus the sub-meter action.
    overdueActions:           3,
    // Management review four months ago, with recorded outputs.
    lastReviewAgeDays:    120,
    lastReviewHasOutputs: true,
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
      '4.1':   'gap',          // the WLS seed records no context issues
      '4.2':   'gap',          // ... no interested parties
      '4.3':   'gap',          // ... no scope
      '5.2':   'gap',          // ... no policy
      '5.3':   'gap',          // ... and no one assigned the 5.3 roles
      '9.1.2': 'gap',          // no compliance evaluation on record
      '7.5':   'gap',          // no documents register yet (phase 3)
      '9.2':   'gap',          // no audit programme yet (phase 4)
      '7.2':   'not_assessed', // no environmental source yet, whatever
      '7.3':   'not_assessed', // the tenant's safety modules hold
      '7.4':   'not_assessed',
      '8.1':   'not_assessed',
      '8.2':   'not_assessed',
    })
  })

  it('lands on Not ready, with the open major named first', () => {
    const card = assessIso14001(demo)
    expect(card.band).toBe('not_ready')
    expect(card.headline).toContain('1 open major nonconformity')
  })

  it('shows every verdict type, so the demo exercises the whole UI', () => {
    const card = assessIso14001(demo)
    expect(card.counts.conforming).toBeGreaterThan(0)
    expect(card.counts.attention).toBeGreaterThan(0)
    expect(card.counts.gap).toBeGreaterThan(0)
    expect(card.counts.not_assessed).toBeGreaterThan(0)
  })

  it('produces the headline migration 256 documents', () => {
    // Only the headline is pinned, not the overall counts. The seed owns
    // eight clauses; the rest of the card depends on what other modules
    // put in the tenant (risks, training currency, inspections), which
    // this fixture cannot speak for — an earlier version of this test
    // asserted counts that did not hold against the real demo tenant.
    const card = assessIso14001(demo)
    expect(card.headline).toBe(
      'Not ready for a certification audit — 1 open major nonconformity; '
      + 'no evidence for clauses 7.5, 9.2.',
    )
    expect(card.blockers.map(b => b.code)).toEqual(['7.5', '9.2'])
  })
})
