// ISO 14001:2015 audit-readiness assessment — the module's report card.
//
// Deliberately NOT called "compliance". Conformity is a certification
// body's verdict, not ours, and an averaged percentage is a dangerous
// thing to hand a customer: one open major nonconformity fails an audit
// no matter how green everything else is. So this module reports
// *evidence coverage* plus *blocking findings*, and the blocking
// findings win.
//
// Shape follows scorecardMetrics.ts: a pure summarizer over
// already-fetched counts, so tests feed fixtures and never touch
// Supabase. The thin reader lives web-side where the auth session is.
//
// The clause list is ISO14001_CLAUSE_MAP (./iso14001). Every code
// assessed here must appear there — assertClauseCoverage() is the
// contract, and the unit test calls it.

import { ISO14001_CLAUSE_MAP } from './iso14001'

// ─── Verdicts ──────────────────────────────────────────────────────────────

export type ClauseVerdict =
  /** Evidence exists, is current, and nothing is outstanding. */
  | 'conforming'
  /** Evidence exists but is stale, incomplete, or has overdue items. */
  | 'attention'
  /** No evidence at all — an auditor would raise a finding. */
  | 'gap'
  /** No module that feeds this clause is enabled for the tenant. */
  | 'not_applicable'

export interface ClauseAssessment {
  code:     string
  title:    string
  verdict:  ClauseVerdict
  /** One sentence an auditor would recognise. Never blames the customer
   *  for a feature the platform has not shipped. */
  reason:   string
  /** True when this single clause is enough to fail an audit. */
  blocking: boolean
  /** Where to go to close it. Null when there is nowhere to send them. */
  fixHref:  string | null
}

export type ReadinessBand = 'ready' | 'ready_with_gaps' | 'not_ready'

export interface Iso14001ReportCard {
  clauses:  readonly ClauseAssessment[]
  /** Share of applicable clauses that are conforming, 0-100 integer.
   *  Labelled "evidence coverage" in every surface — never "compliant". */
  coverage: number
  counts:   Record<ClauseVerdict, number>
  /** Clauses severe enough to fail an audit on their own. */
  blockers: readonly ClauseAssessment[]
  band:     ReadinessBand
  /** Headline sentence for the top of the card. */
  headline: string
}

// ─── Policy constants ──────────────────────────────────────────────────────

// These windows are certification-cycle practice, not clause text — ISO
// 14001 says "at planned intervals", it does not name a number. Grouped
// here so making them tenant-configurable later is a change of source,
// not a rewrite.
export const READINESS_WINDOWS = {
  /** §9.3 — management review, and §9.2 — internal audit. */
  annualReviewDays:    365,
  /** §9.1.1 — a monitored objective needs a reasonably recent reading. */
  objectiveReadingDays: 90,
  /** §7.2 — competence expiring inside this window is a warning. */
  trainingExpiryWarnDays: 30,
} as const

// A gap on one of these is enough to fail an audit on its own: they are
// the clauses a certification body checks first, and the ones with no
// workaround. Everything else degrades the score without blocking.
export const CORE_CLAUSES: readonly string[] = [
  '6.1.2', // Environmental aspects — the defining 14001 artifact
  '6.1.3', // Compliance obligations
  '7.5',   // Documented information
  '9.2',   // Internal audit
  '9.3',   // Management review
  '10.2',  // Nonconformity & corrective action
]

// ─── Input signals ─────────────────────────────────────────────────────────

/** A count-plus-recency pair, the shape most clauses need. */
export interface Recency {
  /** How many qualifying rows exist. */
  count:      number
  /** Age in days of the most recent qualifying row, or null if none. */
  ageDays:    number | null
}

export interface ReadinessSignals {
  /** Module ids the tenant has switched off. Drives `not_applicable`. */
  disabledModules: readonly string[]

  // 4.1 Context
  risks:                 Recency
  // 5.2 Policy · 7.5 Documented information (phase 3 tables)
  documentsRegisterLive: boolean
  policyApproved:        boolean
  policyReviewOverdue:   boolean
  requiredDocsMissing:   number
  docsReviewOverdue:     number
  // 6.1.1
  risksWithoutControls:  number
  // 6.1.2 Aspects
  aspectsTotal:          number
  aspectsSignificant:    number
  significantUncontrolled: number
  aspectsRegisterAgeDays: number | null
  // 6.1.3 / 9.1.2 Compliance obligations
  obligationsTotal:      number
  obligationsOverdue:    number
  complianceEvalAgeDays: number | null
  // 6.1.4
  significantUnaddressed: number
  // 6.2.1 Objectives
  objectivesActive:      number
  objectivesLinked:      number
  objectivesWithTargets: number
  objectivesAchieved:    number
  // 7.2 / 7.3 Competence & awareness
  trainingRecords:       number
  trainingExpired:       number
  trainingExpiringSoon:  number
  awarenessAgeDays:      number | null
  // 7.4 Communication
  communicationAgeDays:  number | null
  // 8.1 Operational control
  operationalInspections: number
  operationalOverdue:     number
  // 8.2 Emergency preparedness
  emergencyDrillAgeDays: number | null
  // 9.1.1 Monitoring
  objectivesStaleReadings: number
  // 9.2 Internal audit (phase 4 tables)
  auditProgrammeLive:    boolean
  lastAuditAgeDays:      number | null
  auditClausesUncovered: number
  // 9.3 Management review
  lastReviewAgeDays:     number | null
  lastReviewHasOutputs:  boolean
  // 10.2 Nonconformities
  nonconformityRegisterLive: boolean
  openMajorNonconformities:  number
  overdueActions:            number
  closedWithoutVerification: number
  // 10.3
  improvementsThisPeriod: number
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function older(ageDays: number | null, days: number): boolean {
  return ageDays === null || ageDays > days
}

/** "1 aspect has" / "3 aspects have". Counts land on one often enough
 *  that "1 aspects have" would show up on a document an auditor reads. */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** Assemble one assessment, resolving `blocking` from CORE_CLAUSES so
 *  the rule lives in exactly one place. */
function assess(
  code: string,
  verdict: ClauseVerdict,
  reason: string,
  fixHref: string | null,
): ClauseAssessment {
  const entry = ISO14001_CLAUSE_MAP.find(c => c.code === code)
  return {
    code,
    title:    entry?.title ?? code,
    verdict,
    reason,
    blocking: verdict === 'gap' && CORE_CLAUSES.includes(code),
    fixHref,
  }
}

/** Pick the first matching rule. Written as an ordered list so each
 *  clause reads top-down: worst case first, conforming last. */
function firstMatch(
  rules: readonly [boolean, ClauseVerdict, string][],
  fallback: [ClauseVerdict, string],
): [ClauseVerdict, string] {
  for (const [when, verdict, reason] of rules) {
    if (when) return [verdict, reason]
  }
  return fallback
}

// ─── The assessment ────────────────────────────────────────────────────────

export function assessIso14001(s: ReadinessSignals): Iso14001ReportCard {
  const off = (moduleId: string) => s.disabledModules.includes(moduleId)
  const out: ClauseAssessment[] = []

  const push = (
    code: string,
    fixHref: string | null,
    rules: readonly [boolean, ClauseVerdict, string][],
    fallback: [ClauseVerdict, string],
  ) => {
    const [verdict, reason] = firstMatch(rules, fallback)
    out.push(assess(code, verdict, reason, fixHref))
  }

  // 4.1 — Context of the organization.
  push('4.1', '/risk', [
    [s.risks.count === 0, 'gap', 'No risk register entries define the organization’s context.'],
    [older(s.risks.ageDays, READINESS_WINDOWS.annualReviewDays), 'attention',
      'The risk register has not been reviewed in over a year.'],
  ], ['conforming', `${s.risks.count} risk register entries, reviewed within the last year.`])

  // 5.2 — Environmental policy. Lives in the documents register (phase 3).
  push('5.2', s.documentsRegisterLive ? '/documents' : null, [
    [!s.documentsRegisterLive, 'gap',
      'No controlled-document register yet, so the environmental policy cannot be version-controlled here.'],
    [!s.policyApproved, 'gap', 'No approved environmental policy document.'],
    [s.policyReviewOverdue, 'attention', 'The environmental policy is past its scheduled review date.'],
  ], ['conforming', 'An approved environmental policy is on file and within its review cycle.'])

  // 6.1.1 — Actions to address risks and opportunities.
  push('6.1.1', '/risk', [
    [s.risks.count === 0, 'gap', 'No risks or opportunities recorded.'],
    [s.risksWithoutControls > 0, 'attention',
      `${count(s.risksWithoutControls, 'risk has', 'risks have')} no control recorded against them.`],
  ], ['conforming', 'Every recorded risk carries at least one control.'])

  // 6.1.2 — Environmental aspects. The defining 14001 register.
  push('6.1.2', '/environmental/aspects', [
    [s.aspectsTotal === 0, 'gap', 'The environmental aspects register is empty.'],
    [s.significantUncontrolled > 0, 'attention',
      `${count(s.significantUncontrolled, 'significant aspect has', 'significant aspects have')} no operational control or linked risk.`],
    [older(s.aspectsRegisterAgeDays, READINESS_WINDOWS.annualReviewDays), 'attention',
      'The aspects register has not been updated in over a year.'],
  ], ['conforming',
    `${s.aspectsTotal} aspects recorded, ${s.aspectsSignificant} significant, all controlled.`])

  // 6.1.3 — Compliance obligations.
  push('6.1.3', '/admin/compliance/calendar', [
    [s.obligationsTotal === 0, 'gap', 'No compliance obligations are on the calendar.'],
    [s.obligationsOverdue > 0, 'attention',
      `${count(s.obligationsOverdue, 'compliance obligation is past its', 'compliance obligations are past their')} due date.`],
  ], ['conforming', `${s.obligationsTotal} obligations tracked, none overdue.`])

  // 6.1.4 — Planning action on significant aspects.
  push('6.1.4', '/environmental/objectives', [
    [s.aspectsSignificant === 0, 'gap', 'No significant aspects have been determined, so no action is planned.'],
    [s.significantUnaddressed > 0, 'attention',
      `${count(s.significantUnaddressed, 'significant aspect has', 'significant aspects have')} no objective, control, or open action.`],
  ], ['conforming', 'Every significant aspect has planned action against it.'])

  // 6.2.1 — Environmental objectives.
  push('6.2.1', '/environmental/objectives', [
    [s.objectivesActive === 0, 'gap', 'No environmental objectives have been set.'],
    [s.objectivesWithTargets < s.objectivesActive, 'attention',
      `${count(s.objectivesActive - s.objectivesWithTargets, 'objective has', 'objectives have')} no measurable target or target date.`],
    [s.objectivesLinked < s.objectivesActive, 'attention',
      `${count(s.objectivesActive - s.objectivesLinked, 'objective is', 'objectives are')} not linked to a significant aspect.`],
  ], ['conforming', `${s.objectivesActive} measurable objectives, each tied to a significant aspect.`])

  // 7.2 — Competence.
  push('7.2', '/admin/people/training-competency-matrix', [
    [off('loto'), 'not_applicable', 'No module contributing competence records is enabled.'],
    [s.trainingRecords === 0, 'gap', 'No training records on file.'],
    [s.trainingExpired > 0, 'attention', `${count(s.trainingExpired, 'required training record has', 'required training records have')} expired.`],
    [s.trainingExpiringSoon > 0, 'attention',
      `${count(s.trainingExpiringSoon, 'training record expires', 'training records expire')} within ${READINESS_WINDOWS.trainingExpiryWarnDays} days.`],
  ], ['conforming', 'Required competence records are current.'])

  // 7.3 — Awareness.
  push('7.3', '/toolbox-talks', [
    [s.awarenessAgeDays === null, 'gap', 'No record of EMS awareness being communicated to workers.'],
    [older(s.awarenessAgeDays, READINESS_WINDOWS.annualReviewDays), 'attention',
      'EMS awareness has not been communicated in over a year.'],
  ], ['conforming', 'EMS awareness communicated within the last year.'])

  // 7.4 — Communication.
  push('7.4', '/safety-boards', [
    [s.communicationAgeDays === null, 'gap', 'No internal or external environmental communication recorded.'],
    [older(s.communicationAgeDays, READINESS_WINDOWS.annualReviewDays), 'attention',
      'No environmental communication recorded in over a year.'],
  ], ['conforming', 'Environmental communication recorded within the last year.'])

  // 7.5 — Documented information. Register arrives in phase 3.
  push('7.5', s.documentsRegisterLive ? '/documents' : null, [
    [!s.documentsRegisterLive, 'gap',
      'No controlled-document register yet — documented information cannot be version-controlled in the platform.'],
    [s.requiredDocsMissing > 0, 'gap',
      `${count(s.requiredDocsMissing, 'document the standard requires is', 'documents the standard requires are')} absent from the register.`],
    [s.docsReviewOverdue > 0, 'attention',
      `${count(s.docsReviewOverdue, 'controlled document is past its', 'controlled documents are past their')} review date.`],
  ], ['conforming', 'Every required document is approved and within its review cycle.'])

  // 8.1 — Operational planning and control.
  push('8.1', '/inspections', [
    [s.operationalInspections === 0, 'gap', 'No operational control checks have been carried out.'],
    [s.operationalOverdue > 0, 'attention', `${count(s.operationalOverdue, 'operational check is', 'operational checks are')} overdue.`],
  ], ['conforming', `${s.operationalInspections} operational control checks completed on cadence.`])

  // 8.2 — Emergency preparedness and response.
  push('8.2', '/incidents', [
    [s.emergencyDrillAgeDays === null, 'gap', 'No emergency preparedness drill or test on record.'],
    [older(s.emergencyDrillAgeDays, READINESS_WINDOWS.annualReviewDays), 'attention',
      'No emergency preparedness drill or test in over a year.'],
  ], ['conforming', 'Emergency preparedness tested within the last year.'])

  // 9.1.1 — Monitoring, measurement, analysis and evaluation.
  push('9.1.1', '/environmental/objectives', [
    [s.objectivesActive === 0, 'gap', 'Nothing is being monitored — no active objectives.'],
    [s.objectivesStaleReadings > 0, 'attention',
      `${count(s.objectivesStaleReadings, 'objective has', 'objectives have')} no reading in the last ${READINESS_WINDOWS.objectiveReadingDays} days.`],
  ], ['conforming', 'Every active objective has a current reading.'])

  // 9.1.2 — Evaluation of compliance.
  push('9.1.2', '/admin/compliance/calendar', [
    [s.complianceEvalAgeDays === null, 'gap', 'Compliance status has never been formally evaluated.'],
    [older(s.complianceEvalAgeDays, READINESS_WINDOWS.annualReviewDays), 'attention',
      'Compliance has not been evaluated in over a year.'],
  ], ['conforming', 'Compliance evaluated within the last year.'])

  // 9.2 — Internal audit. Programme arrives in phase 4.
  push('9.2', s.auditProgrammeLive ? '/environmental/audits' : null, [
    [!s.auditProgrammeLive, 'gap',
      'No internal-audit programme yet — audit planning and clause coverage are not tracked in the platform.'],
    [s.lastAuditAgeDays === null, 'gap', 'No internal audit has been carried out.'],
    [older(s.lastAuditAgeDays, READINESS_WINDOWS.annualReviewDays), 'attention',
      'The last internal audit was over a year ago.'],
    [s.auditClausesUncovered > 0, 'attention',
      `${count(s.auditClausesUncovered, 'clause has', 'clauses have')} not been audited in the current cycle.`],
  ], ['conforming', 'The internal-audit programme covers every clause and is current.'])

  // 9.3 — Management review.
  push('9.3', '/environmental/management-review', [
    [s.lastReviewAgeDays === null, 'gap', 'No management review has been held.'],
    [older(s.lastReviewAgeDays, READINESS_WINDOWS.annualReviewDays), 'attention',
      'The last management review was over a year ago.'],
    [!s.lastReviewHasOutputs, 'attention',
      'The last management review has no recorded conclusions or decisions.'],
  ], ['conforming', 'A management review with recorded outputs was held within the last year.'])

  // 10.2 — Nonconformity and corrective action.
  push('10.2', '/environmental/nonconformities', [
    [!s.nonconformityRegisterLive, 'gap', 'No nonconformity register.'],
    [s.openMajorNonconformities > 0, 'attention',
      `${count(s.openMajorNonconformities, 'major nonconformity is', 'major nonconformities are')} open.`],
    [s.overdueActions > 0, 'attention', `${count(s.overdueActions, 'corrective action is', 'corrective actions are')} overdue.`],
    [s.closedWithoutVerification > 0, 'attention',
      `${count(s.closedWithoutVerification, 'nonconformity was', 'nonconformities were')} closed without an effectiveness check.`],
  ], ['conforming', 'Findings are being closed with verified corrective actions.'])

  // 10.3 — Continual improvement.
  push('10.3', '/environmental/objectives', [
    [s.improvementsThisPeriod === 0 && s.objectivesAchieved === 0, 'gap',
      'No improvement activity recorded — no objectives achieved and no findings verified closed.'],
    [s.improvementsThisPeriod === 0, 'attention', 'No findings verified closed this period.'],
  ], ['conforming', 'Continual improvement is evidenced by achieved objectives and verified actions.'])

  return rollUp(out, s)
}

// ─── Roll-up ───────────────────────────────────────────────────────────────

function rollUp(clauses: ClauseAssessment[], s: ReadinessSignals): Iso14001ReportCard {
  const counts: Record<ClauseVerdict, number> = {
    conforming: 0, attention: 0, gap: 0, not_applicable: 0,
  }
  for (const c of clauses) counts[c.verdict]++

  const applicable = clauses.length - counts.not_applicable
  const coverage = applicable === 0
    ? 0
    : Math.round((counts.conforming / applicable) * 100)

  // An open major is a blocker in its own right even though 10.2 reads
  // "attention" — the register is working, the finding is not closed.
  // This is the whole reason coverage cannot be the headline.
  const blockers = clauses.filter(c => c.blocking)
  const openMajor = s.openMajorNonconformities > 0

  const band: ReadinessBand =
    openMajor || blockers.length > 0 ? 'not_ready'
      : counts.attention > 0 || counts.gap > 0 ? 'ready_with_gaps'
        : 'ready'

  return { clauses, coverage, counts, blockers, band, headline: headlineFor(band, blockers, s) }
}

function headlineFor(
  band: ReadinessBand,
  blockers: readonly ClauseAssessment[],
  s: ReadinessSignals,
): string {
  if (band === 'ready') return 'Every applicable clause has current evidence.'
  if (band === 'ready_with_gaps') return 'Evidence is in place, with clauses needing attention before an audit.'

  const parts: string[] = []
  if (s.openMajorNonconformities > 0) {
    parts.push(count(s.openMajorNonconformities, 'open major nonconformity', 'open major nonconformities'))
  }
  if (blockers.length > 0) {
    const codes = blockers.map(b => b.code).join(', ')
    parts.push(`no evidence for ${blockers.length === 1 ? 'clause' : 'clauses'} ${codes}`)
  }
  return `Not ready for a certification audit — ${parts.join('; ')}.`
}

// ─── Contract ──────────────────────────────────────────────────────────────

/** Throws when the assessment and ISO14001_CLAUSE_MAP have drifted apart.
 *  Called by the unit test: adding a clause to the map without assessing
 *  it (or vice versa) is a bug, not a warning. */
export function assertClauseCoverage(assessed: readonly string[]): void {
  const mapped = new Set(ISO14001_CLAUSE_MAP.map(c => c.code))
  const seen   = new Set(assessed)
  const missing = [...mapped].filter(c => !seen.has(c))
  const extra   = [...seen].filter(c => !mapped.has(c))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `ISO 14001 readiness drifted from ISO14001_CLAUSE_MAP — ` +
      `unassessed: [${missing.join(', ')}], not in map: [${extra.join(', ')}]`,
    )
  }
}
