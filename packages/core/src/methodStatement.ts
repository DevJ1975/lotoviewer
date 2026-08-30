// Method statement (SWMS / RAMS) — the one regulatory document type the
// platform has no representation for at all. Pure: types + completeness rules.
//
// WHAT IT IS AND HOW IT DIFFERS FROM A JHA
// A JHA (see jha.ts) decomposes a task into steps and identifies the hazards in
// each — it answers "what could hurt someone here". A method statement answers
// the adjacent question: "how, specifically, will this job be done safely" —
// the sequence, who is competent to do each part, what plant and materials are
// involved, and what happens when it goes wrong. Principal contractors ask for
// the method statement; the risk assessment is its companion, which is why the
// pairing is usually written RAMS.
//
// This module models the document, not a database table. It exists so the
// draft service has a typed target and a completeness rule that is the same in
// the generator, the reviewer's screen, and the tests — rather than three
// slightly different notions of "finished".

import { HIERARCHY_ORDER, type HierarchyLevel } from './risk'

// ──────────────────────────────────────────────────────────────────────────
// Shape
// ──────────────────────────────────────────────────────────────────────────

export interface MethodStatementStep {
  /** 1-based position in the sequence. */
  sequence:    number
  /** What is done, in the imperative. One action per step. */
  description: string
  /** Hazards this step introduces or exposes. */
  hazards:     string[]
  /** Controls applied to this step, each placed on the hierarchy. */
  controls:    MethodStatementControl[]
  /** Role accountable for this step — a role, never a named individual, so the
   *  document survives staff turnover. */
  responsibleRole: string
}

export interface MethodStatementControl {
  description:    string
  hierarchyLevel: HierarchyLevel
}

export interface MethodStatement {
  title:        string
  /** Required, never inferred — the mandatory sections differ by regime. */
  jurisdiction: string
  /** What the job covers, and explicitly what it does not. */
  scope:        string
  location:     string
  /** Ordered sequence of work. */
  steps:        MethodStatementStep[]
  /** PPE required for the whole job, beyond any step-specific control. */
  ppe:          string[]
  /** Plant, tools, and equipment the job depends on. */
  plantAndEquipment: string[]
  /** Competencies, tickets, or certifications the crew must hold. */
  competencies: string[]
  /** What to do when it goes wrong — rescue, isolation, first aid, escalation. */
  emergencyArrangements: string
}

// ──────────────────────────────────────────────────────────────────────────
// Completeness
// ──────────────────────────────────────────────────────────────────────────

export type MethodStatementIssueSeverity = 'blocking' | 'advisory'

export interface MethodStatementIssue {
  /** Dotted path to the offending field, e.g. `steps.2.controls`. */
  path:     string
  message:  string
  severity: MethodStatementIssueSeverity
}

export interface MethodStatementValidation {
  /** True when nothing blocking remains. Advisory issues may still be present. */
  ok:     boolean
  issues: MethodStatementIssue[]
}

const MIN_SCOPE_LENGTH = 20

/**
 * Checks a method statement for the omissions that make one unusable in the
 * field.
 *
 * Blocking vs advisory is the important distinction. Blocking issues are
 * structural — a step with no control, a job with no emergency arrangements —
 * and no reviewer should be able to sign past them. Advisory issues are
 * judgement calls a competent person may legitimately override, most notably
 * relying on PPE alone: ISO 45001 8.1.2 puts PPE at the bottom of the hierarchy,
 * but there are real steps where it is genuinely all that is left. Making that
 * blocking would train reviewers to bypass the check, which is worse than
 * flagging it.
 */
export function validateMethodStatement(ms: MethodStatement): MethodStatementValidation {
  const issues: MethodStatementIssue[] = []

  const blocking = (path: string, message: string) =>
    issues.push({ path, message, severity: 'blocking' })
  const advisory = (path: string, message: string) =>
    issues.push({ path, message, severity: 'advisory' })

  if (ms.title.trim().length === 0) blocking('title', 'The method statement needs a title.')
  if (ms.jurisdiction.trim().length === 0) {
    blocking('jurisdiction', 'State the jurisdiction — mandatory sections differ by regime.')
  }
  if (ms.scope.trim().length < MIN_SCOPE_LENGTH) {
    blocking('scope', 'Describe the scope of work, including what this method statement does not cover.')
  }
  if (ms.emergencyArrangements.trim().length === 0) {
    blocking('emergencyArrangements', 'State the emergency arrangements — rescue, isolation, first aid, and who to call.')
  }
  if (ms.steps.length === 0) {
    blocking('steps', 'A method statement needs at least one work step.')
  }
  if (ms.competencies.length === 0) {
    advisory('competencies', 'No required competencies listed — confirm the crew needs no specific ticket for this work.')
  }

  const seenSequences = new Set<number>()
  ms.steps.forEach((step, index) => {
    const at = `steps.${index}`

    if (step.description.trim().length === 0) {
      blocking(`${at}.description`, 'Step has no description.')
    }
    if (step.responsibleRole.trim().length === 0) {
      blocking(`${at}.responsibleRole`, 'Step has nobody accountable for it.')
    }
    if (seenSequences.has(step.sequence)) {
      blocking(`${at}.sequence`, `Duplicate step number ${step.sequence} — the sequence must be unambiguous.`)
    }
    seenSequences.add(step.sequence)

    if (step.hazards.length === 0) {
      // A step with no hazards is either genuinely benign or unexamined, and
      // the document cannot tell a reviewer which.
      advisory(`${at}.hazards`, 'Step lists no hazards — confirm this step is genuinely benign.')
      return
    }
    if (step.controls.length === 0) {
      blocking(`${at}.controls`, 'Step identifies hazards but applies no controls.')
      return
    }
    if (step.controls.every(c => c.hierarchyLevel === 'ppe')) {
      advisory(`${at}.controls`, 'Step relies on PPE alone — check whether an engineering or administrative control is reasonably practicable.')
    }
  })

  return { ok: !issues.some(i => i.severity === 'blocking'), issues }
}

/**
 * The highest control applied anywhere in the job, for the document header.
 *
 * Reuses the risk module's hierarchy ordering rather than restating it, so a
 * change to the hierarchy cannot leave the two disagreeing. Null when no step
 * applies any control.
 */
export function strongestControlLevel(ms: MethodStatement): HierarchyLevel | null {
  let best: HierarchyLevel | null = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const step of ms.steps) {
    for (const control of step.controls) {
      const rank = HIERARCHY_ORDER.indexOf(control.hierarchyLevel)
      if (rank !== -1 && rank < bestRank) {
        bestRank = rank
        best = control.hierarchyLevel
      }
    }
  }
  return best
}
