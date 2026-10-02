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
  /** The platform holds no environmental record this clause can be judged
   *  from yet. Neither conforming nor a gap: the evidence may well exist
   *  outside the platform, and the card must not guess either way. */
  | 'not_assessed'

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
  /** Share of clauses that are conforming, 0-100 integer. A clause the
   *  platform cannot assess stays in the denominator: coverage is what the
   *  platform can evidence, so it never rises by leaving a clause out.
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
  // 4.1 Context (the context register)
  contextIssuesActive:        number
  contextIssuesReviewOverdue: number
  /** An active climate-kind issue records the climate-change determination (Amd 1:2024). */
  climateIssueRecorded:       boolean
  // 4.2 Interested parties
  interestedPartiesActive:        number
  interestedPartiesReviewOverdue: number
  // 4.3 Scope
  scopeOnFile:           boolean
  scopeReviewOverdue:    boolean
  // 5.2 Policy (the versioned policy record)
  /** The policy in force is signed and states every commitment its standard requires. */
  policyApproved:        boolean
  policyReviewOverdue:   boolean
  /** The legal entity changed after the policy was signed (Lesson L3). */
  policySignatoryStale:  boolean
  // 6.1.1 and 6.1.4 (the risk register)
  risks:                 Recency
  // 7.5 Documented information (phase 3 tables)
  documentsRegisterLive: boolean
  requiredDocsMissing:   number
  docsReviewOverdue:     number
  // 6.1.1
  risksWithoutControls:  number
  // 6.1.2 Aspects (active ones)
  aspectsTotal:          number
  aspectsSignificant:    number
  significantUncontrolled: number
  /** Active aspects with no score under any operating condition. */
  aspectsUnscored:       number
  aspectsReviewOverdue:  number
  // 6.1.3 / 9.1.2 Compliance obligations (the environmental register)
  obligationsTotal:      number
  /** Obligations past their calendar deadline. */
  obligationsOverdue:    number
  obligationsReviewOverdue: number
  /** Age of the newest evaluation that established compliance status (any result but undetermined). */
  complianceEvalAgeDays: number | null
  /** Open compliance evaluations past their scheduled date. */
  evaluationsOverdue:    number
  /** Obligations with no evaluation frequency: clause 9.1.2 a) asks for one for each. */
  obligationsUnscheduled: number
  /** Obligations whose latest result is undetermined: their compliance status is unknown. */
  evaluationsUndetermined: number
  // 6.1.4
  significantUnaddressed: number
  // 6.2.1 Objectives
  objectivesActive:      number
  objectivesLinked:      number
  objectivesWithTargets: number
  objectivesAchieved:    number
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
  push('4.1', '/environmental/context', [
    [s.contextIssuesActive === 0, 'gap', 'No internal or external issues are recorded in the context register.'],
    [!s.climateIssueRecorded, 'attention',
      'The context register does not yet record whether climate change is a relevant issue (Amendment 1:2024).'],
    [s.contextIssuesReviewOverdue > 0, 'attention',
      `${count(s.contextIssuesReviewOverdue, 'context issue is past its', 'context issues are past their')} review date.`],
  ], ['conforming',
    `${count(s.contextIssuesActive, 'context issue', 'context issues')} recorded, the climate-change determination among them, all within review.`])

  // 4.2 — Needs and expectations of interested parties.
  push('4.2', '/environmental/context?tab=parties', [
    [s.interestedPartiesActive === 0, 'gap', 'No interested parties or their needs and expectations are recorded.'],
    [s.interestedPartiesReviewOverdue > 0, 'attention',
      `${count(s.interestedPartiesReviewOverdue, 'interested party is past its', 'interested parties are past their')} review date.`],
  ], ['conforming',
    `${count(s.interestedPartiesActive, 'interested party', 'interested parties')} recorded with their needs, all within review.`])

  // 4.3 — Scope of the EMS.
  push('4.3', '/environmental/context?tab=scope', [
    [!s.scopeOnFile, 'gap', 'The scope of the environmental management system is not documented.'],
    [s.scopeReviewOverdue, 'attention', 'The EMS scope is past its review date.'],
  ], ['conforming', 'The EMS scope is documented and within its review date.'])

  // 5.2 — Environmental policy.
  push('5.2', '/environmental/context?tab=policy', [
    [!s.policyApproved, 'gap',
      'No signed environmental policy stating every commitment the standard requires.'],
    [s.policySignatoryStale, 'attention',
      'The policy was signed before the organization’s legal entity changed, so it carries a prior owner’s signature.'],
    [s.policyReviewOverdue, 'attention', 'The environmental policy is past its scheduled review date.'],
  ], ['conforming', 'A signed environmental policy states every required commitment and is within its review cycle.'])

  // 6.1.1 — Actions to address risks and opportunities.
  push('6.1.1', '/risk', [
    [s.risks.count === 0, 'gap', 'No risks or opportunities recorded.'],
    [s.risksWithoutControls > 0, 'attention',
      `${count(s.risksWithoutControls, 'risk has', 'risks have')} no control recorded against them.`],
  ], ['conforming', 'Every recorded risk carries at least one control.'])

  // 6.1.2 — Environmental aspects. The defining 14001 register.
  push('6.1.2', '/environmental/aspects', [
    [s.aspectsTotal === 0, 'gap', 'The environmental aspects register is empty.'],
    [s.aspectsUnscored > 0, 'attention',
      `${count(s.aspectsUnscored, 'aspect has', 'aspects have')} not been scored under any operating condition.`],
    [s.significantUncontrolled > 0, 'attention',
      `${count(s.significantUncontrolled, 'significant aspect has', 'significant aspects have')} no operational control or linked risk.`],
    [s.aspectsReviewOverdue > 0, 'attention',
      `${count(s.aspectsReviewOverdue, 'aspect is past its', 'aspects are past their')} review date.`],
  ], ['conforming',
    `${s.aspectsTotal} aspects recorded, ${s.aspectsSignificant} significant, all scored, controlled and within review.`])

  // 6.1.3 — Compliance obligations.
  push('6.1.3', '/environmental/obligations', [
    [s.obligationsTotal === 0, 'gap', 'The compliance obligations register is empty.'],
    [s.obligationsOverdue > 0, 'attention',
      `${count(s.obligationsOverdue, 'compliance obligation is past its', 'compliance obligations are past their')} due date.`],
    [s.obligationsReviewOverdue > 0, 'attention',
      `${count(s.obligationsReviewOverdue, 'obligation is past its', 'obligations are past their')} register review date.`],
  ], ['conforming', `${s.obligationsTotal} obligations in the register, none overdue.`])

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

  // 7.2 to 7.4 — no environmental source yet. LOTO training, toolbox
  // talks and Prop 65 notices are safety and right-to-know records: grading
  // these clauses from them showed conformity an auditor would reject, and
  // their absence showed gaps that may not exist. Phase 6 brings the
  // environmental training matrix and communications log.
  out.push(assess('7.2', 'not_assessed',
    'Not assessed: the platform holds no environmental competence records yet, and safety training is not evidence for this clause.',
    null))
  out.push(assess('7.3', 'not_assessed',
    'Not assessed: the platform does not yet record whether workers know the policy and the significant aspects of their work.',
    null))
  out.push(assess('7.4', 'not_assessed',
    'Not assessed: the platform does not yet keep a log of internal and external environmental communication.',
    null))

  // 7.5 — Documented information. Register arrives in phase 3.
  push('7.5', s.documentsRegisterLive ? '/documents' : null, [
    [!s.documentsRegisterLive, 'gap',
      'No controlled-document register yet — documented information cannot be version-controlled in the platform.'],
    [s.requiredDocsMissing > 0, 'gap',
      `${count(s.requiredDocsMissing, 'document the standard requires is', 'documents the standard requires are')} absent from the register.`],
    [s.docsReviewOverdue > 0, 'attention',
      `${count(s.docsReviewOverdue, 'controlled document is past its', 'controlled documents are past their')} review date.`],
  ], ['conforming', 'Every required document is approved and within its review cycle.'])

  // 8.1 and 8.2 — likewise. An inspection says nothing about which aspect
  // or obligation it controls until Phases 2 and 4 tie them together, and
  // nothing in the platform records an environmental drill yet.
  out.push(assess('8.1', 'not_assessed',
    'Not assessed: the platform does not yet tie operational checks to significant aspects or compliance obligations.',
    null))
  out.push(assess('8.2', 'not_assessed',
    'Not assessed: the platform does not yet record environmental emergency drills or tests.',
    null))

  // 9.1.1 — Monitoring, measurement, analysis and evaluation.
  push('9.1.1', '/environmental/objectives', [
    [s.objectivesActive === 0, 'gap', 'Nothing is being monitored — no active objectives.'],
    [s.objectivesStaleReadings > 0, 'attention',
      `${count(s.objectivesStaleReadings, 'objective has', 'objectives have')} no reading in the last ${READINESS_WINDOWS.objectiveReadingDays} days.`],
  ], ['conforming', 'Every active objective has a current reading.'])

  // 9.1.2 — Evaluation of compliance.
  push('9.1.2', '/environmental/obligations', [
    [s.complianceEvalAgeDays === null, 'gap', 'Compliance status has never been formally evaluated.'],
    [s.evaluationsOverdue > 0, 'attention',
      `${count(s.evaluationsOverdue, 'compliance evaluation is', 'compliance evaluations are')} past due.`],
    [s.evaluationsUndetermined > 0, 'attention',
      `${count(s.evaluationsUndetermined, 'obligation has', 'obligations have')} an undetermined compliance status.`],
    [s.obligationsUnscheduled > 0, 'attention',
      `${count(s.obligationsUnscheduled, 'obligation has', 'obligations have')} no evaluation frequency (clause 9.1.2 a).`],
    [older(s.complianceEvalAgeDays, READINESS_WINDOWS.annualReviewDays), 'attention',
      'Compliance has not been evaluated in over a year.'],
  ], ['conforming', 'Compliance evaluated against evidence within the last year, with nothing past due.'])

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
    conforming: 0, attention: 0, gap: 0, not_assessed: 0,
  }
  for (const c of clauses) counts[c.verdict]++

  const coverage = clauses.length === 0
    ? 0
    : Math.round((counts.conforming / clauses.length) * 100)

  // An open major is a blocker in its own right even though 10.2 reads
  // "attention" — the register is working, the finding is not closed.
  // This is the whole reason coverage cannot be the headline.
  const blockers = clauses.filter(c => c.blocking)
  const openMajor = s.openMajorNonconformities > 0

  // "Ready" is a claim about every clause, so one the platform cannot see
  // holds the band at ready-with-gaps however green the rest is.
  const band: ReadinessBand =
    openMajor || blockers.length > 0 ? 'not_ready'
      : counts.attention > 0 || counts.gap > 0 || counts.not_assessed > 0 ? 'ready_with_gaps'
        : 'ready'

  return { clauses, coverage, counts, blockers, band, headline: headlineFor(band, clauses, blockers, s) }
}

function headlineFor(
  band: ReadinessBand,
  clauses: readonly ClauseAssessment[],
  blockers: readonly ClauseAssessment[],
  s: ReadinessSignals,
): string {
  if (band === 'ready') return 'Every clause has current evidence.'
  if (band === 'ready_with_gaps') {
    const unassessed = clauses.filter(c => c.verdict === 'not_assessed').map(c => c.code)
    const needsWork = clauses.some(c => c.verdict === 'attention' || c.verdict === 'gap')
    if (!needsWork) {
      return `Every clause the platform can assess has current evidence. Check ${unassessed.join(', ')} against your own records before an audit.`
    }
    return 'Evidence is in place, with clauses needing attention before an audit.'
  }

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
