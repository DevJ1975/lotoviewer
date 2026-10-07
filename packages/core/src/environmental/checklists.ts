// Environmental checklists on the generic inspection engine.
//
// A library template becomes ordinary inspection_templates / _items rows, so
// scoring, the response storage and the audit trail are the engine's own. What
// is environmental lives in a companion row (library key, jurisdiction, program)
// and in each item's `config` (citations, whether a failure is critical, the ISO
// clause it evidences). This module is the pure translation in both directions.

import { advanceDueDate, classifyUrgency, daysUntilDue, type ObligationCadence } from '../complianceCalendar'
import { isScorableType, type InspectionItemType } from '../inspectionScoring'
import { applies, type ApplicabilityContext } from './applicability'
import type { Citation, ResolvedChecklistTemplate } from './content'
import type { JurisdictionCode } from './jurisdiction'
import type { ChecklistSubjectType } from './content'
import type { EnvProgram } from './siteProfile'

export const ENV_TEMPLATE_CATEGORY = 'environmental'

export interface TemplateInsert {
  name:         string
  description:  string
  category:     typeof ENV_TEMPLATE_CATEGORY
  scoring_mode: 'weighted'
}

export interface TemplateItemInsert {
  section:             string
  sort_order:          number
  item_type:           InspectionItemType
  prompt:              string
  required:            boolean
  weight:              number
  fail_creates_action: boolean
  config:              Record<string, unknown>
}

export interface CompanionInsert {
  library_key:      string
  jurisdiction_key: string
  program:          EnvProgram
  subject_type:     ChecklistSubjectType
  cadence:          ObligationCadence
  cadence_days:     number | null
  library_version:  string
  last_verified:    string | null
}

export interface TemplateRows {
  template:  TemplateInsert
  items:     TemplateItemInsert[]
  companion: CompanionInsert
}

/** The key a template instance is stored under: library id + the layers that built it. */
export function jurisdictionKey(chain: readonly JurisdictionCode[]): string {
  return chain.join('+')
}

const configCitations = (citations: Citation[]) =>
  citations.map(c => ({ ref: c.ref, ...(c.title ? { title: c.title } : {}), ...(c.verify ? { verify: c.verify } : {}) }))

/**
 * The rows for one template at one site. Only the items that apply to the site
 * are included, in library order. Numeric limits go in `config.min/max`, where
 * the engine's submit route reads them to pass or fail a reading.
 */
export function buildTemplateRows(
  template: ResolvedChecklistTemplate,
  context: ApplicabilityContext,
  chain: readonly JurisdictionCode[],
  version: { libraryVersion: string; lastVerified: string | null },
): TemplateRows {
  const items = template.items
    .filter(item => applies(item.appliesWhen, context))
    .map((item, index): TemplateItemInsert => ({
      section:             item.section,
      sort_order:          index,
      item_type:           item.itemType,
      prompt:              item.prompt,
      required:            item.required,
      weight:              item.weight,
      fail_creates_action: item.failCreatesAction,
      config: {
        library_item_id: item.id,
        critical:        item.critical,
        citations:       configCitations(item.citations),
        ...(item.clauseRef ? { clause_ref: item.clauseRef } : {}),
        ...(item.guidance ? { guidance: item.guidance } : {}),
        ...(item.numeric ? {
          unit: item.numeric.unit,
          ...(item.numeric.min !== undefined ? { min: item.numeric.min } : {}),
          ...(item.numeric.max !== undefined ? { max: item.numeric.max } : {}),
        } : {}),
      },
    }))
  return {
    template: { name: template.name, description: template.description, category: ENV_TEMPLATE_CATEGORY, scoring_mode: 'weighted' },
    items,
    companion: {
      library_key:      template.id,
      jurisdiction_key: jurisdictionKey(chain),
      program:          template.program,
      subject_type:     template.subjectType,
      cadence:          template.cadence,
      cadence_days:     template.cadenceDays ?? null,
      library_version:  version.libraryVersion,
      last_verified:    version.lastVerified,
    },
  }
}

export interface AnswerLike {
  itemId:     string
  result:     'pass' | 'fail' | 'na' | null
  value?:     unknown
  evidenceId?: string | null
  note?:      string | null
}

export interface RequirableItem {
  id:       string
  itemType: InspectionItemType
  required: boolean
}

function isAnswered(item: RequirableItem, answer: AnswerLike | undefined): boolean {
  if (!answer) return false
  switch (item.itemType) {
    case 'pass_fail_na':
      return answer.result !== null
    case 'multiple_choice':
      return answer.result !== null || (typeof answer.value === 'string' && answer.value.trim() !== '')
    case 'numeric':
      return typeof answer.value === 'number' && Number.isFinite(answer.value)
    case 'text':
      return typeof answer.value === 'string' && answer.value.trim() !== ''
    case 'photo':
      return typeof answer.evidenceId === 'string' && answer.evidenceId !== ''
    case 'signature':
      return (typeof answer.value === 'string' && answer.value.trim() !== '') || (typeof answer.evidenceId === 'string' && answer.evidenceId !== '')
  }
}

/**
 * The required items still unanswered. The generic engine does not enforce
 * `required`; for a compliance record "I skipped the question" must not read as
 * "I passed", so the environmental submit refuses until this is empty.
 */
export function missingRequiredItems(items: readonly RequirableItem[], answers: readonly AnswerLike[]): string[] {
  const byItem = new Map(answers.map(a => [a.itemId, a]))
  return items.filter(item => item.required && !isAnswered(item, byItem.get(item.id))).map(item => item.id)
}

export type NonconformityClassification = 'observation' | 'minor' | 'major'

export interface FailableItem {
  id:                string
  prompt:            string
  itemType:          InspectionItemType
  failCreatesAction: boolean
  critical:          boolean
  clauseRef?:        string
  citations:         Citation[]
}

export interface NonconformityInsert {
  title:            string
  description:      string
  source_type:      'inspection'
  source_reference: string
  classification:   NonconformityClassification
  clause_ref:       string
  identified_at:    string
  identified_by:    string | null
  owner_user_id:    string | null
  facility_id:      string | null
}

const DEFAULT_CLAUSE = '8.1'
const MAX_TITLE = 200

/**
 * The findings a submitted checklist raises: one per failed item that is set to
 * create an action. Their classification is a starting point for a person, never
 * a verdict: a critical failure is raised as MINOR and anything else as an
 * observation, and nothing is ever raised as MAJOR automatically, because
 * classifying a nonconformity is the auditor's judgment. `source_reference` is
 * unique per (inspection, item), so submitting twice cannot raise a finding twice.
 */
export function failuresToNonconformities(args: {
  inspectionId:  string
  templateName:  string
  subjectLabel?: string | null
  facilityId:    string | null
  items:         readonly FailableItem[]
  answers:       readonly AnswerLike[]
  identifiedAt:  string
  identifiedBy:  string | null
  ownerUserId:   string | null
}): NonconformityInsert[] {
  const answers = new Map(args.answers.map(a => [a.itemId, a]))
  const rows: NonconformityInsert[] = []
  for (const item of args.items) {
    const answer = answers.get(item.id)
    if (answer?.result !== 'fail' || !isScorableType(item.itemType) || !item.failCreatesAction) continue
    const where = args.subjectLabel ? ` (${args.subjectLabel})` : ''
    const lines = [
      `Failed on "${args.templateName}"${where}: ${item.prompt}`,
      answer.note ? `Note: ${answer.note}` : null,
      item.citations.length > 0 ? `Basis: ${item.citations.map(c => c.ref).join('; ')}` : null,
      answer.evidenceId ? 'A photo was attached to the checklist.' : null,
      item.critical ? 'This item is marked critical.' : null,
    ].filter((l): l is string => l !== null)
    rows.push({
      title:            `${args.templateName}: ${item.prompt}`.slice(0, MAX_TITLE),
      description:      lines.join('\n'),
      source_type:      'inspection',
      source_reference: `env-checklist:${args.inspectionId}:${item.id}`,
      classification:   item.critical ? 'minor' : 'observation',
      clause_ref:       item.clauseRef ?? DEFAULT_CLAUSE,
      identified_at:    args.identifiedAt,
      identified_by:    args.identifiedBy,
      owner_user_id:    args.ownerUserId,
      facility_id:      args.facilityId,
    })
  }
  return rows
}

export type ChecklistDueStatus = 'never' | 'ok' | 'due_soon' | 'overdue'

const CHECKLIST_DUE_SOON_DAYS = 14

/**
 * An interval-based hint ("last done N days ago, every quarter"). The compliance
 * calendar, which knows the regulatory period, stays the authority on whether a
 * checklist is late; this is for showing a quick status beside a template.
 */
export function checklistDueStatus(
  lastCompletedOn: string | null, cadence: ObligationCadence, cadenceDays: number | null, now: Date = new Date(),
): { status: ChecklistDueStatus; dueOn: string | null; daysUntil: number | null } {
  if (lastCompletedOn === null) return { status: 'never', dueOn: null, daysUntil: null }
  const dueOn = advanceDueDate(lastCompletedOn, cadence, cadenceDays, { clampToMonthEnd: true })
  const urgency = classifyUrgency(dueOn, now, CHECKLIST_DUE_SOON_DAYS)
  return {
    status: urgency === 'overdue' ? 'overdue' : urgency === 'due_soon' ? 'due_soon' : 'ok',
    dueOn,
    daysUntil: daysUntilDue(dueOn, now),
  }
}
