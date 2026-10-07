import { advanceDueDate, type ObligationCadence } from '@soteria/core/complianceCalendar'
import { applies } from '@soteria/core/environmental/applicability'
import {
  buildTemplateRows, failuresToNonconformities, missingRequiredItems,
  type AnswerLike, type FailableItem, type NonconformityInsert, type TemplateRows,
} from '@soteria/core/environmental/checklists'
import type { Citation, ChecklistSubjectType } from '@soteria/core/environmental/content'
import { evaluateNumeric, scoreInspection, type InspectionItemType, type ResponseResult } from '@soteria/core/inspectionScoring'
import { libraryVersionLabel, oldestVerification } from './applyLibrary'
import type { SiteContext } from './siteContext'

// Running an environmental checklist: start one for a site, then submit it.
//
// Start finds-or-creates the template instance the site's profile calls for,
// resumes an unfinished run rather than opening a duplicate, and refuses a
// subject (an outfall, a permit) that is not this site's.
//
// Submit is ordered so that "submitted" means everything else already happened.
// Responses, findings and the calendar completion are each idempotent, and the
// status flip to submitted is the last step and the commit point: a failure
// anywhere earlier leaves the run in progress and a retry redoes the lot
// without raising a finding twice or advancing a deadline twice.

export interface ObligationRow {
  id:            string
  title:         string
  status:        'open' | 'completed' | 'dismissed'
  cadence:       ObligationCadence
  cadence_days:  number | null
  next_due_at:   string
  due_anchor:    'fixed' | 'period_end'
  owner_user_id: string | null
  facility_id:   string | null
  library_key:   string | null
}

export interface RunItem {
  id:                  string
  item_type:           InspectionItemType
  prompt:              string
  section:             string
  sort_order:          number
  required:            boolean
  weight:              number
  fail_creates_action: boolean
  config:              Record<string, unknown>
}

export interface RunResponse {
  item_id:     string
  value:       unknown
  result:      ResponseResult | null
  evidence_id: string | null
  note:        string | null
}

export interface RunSnapshot {
  inspection: {
    id: string; title: string; status: 'in_progress' | 'submitted'; domain: string
    template_id: string; facility_id: string | null
    score: number | null; max_score: number | null; result: 'pass' | 'fail' | null
  }
  run: {
    obligation_id: string | null; occurrence_at: string | null
    subject_type: string | null; subject_id: string | null
    attested: boolean; signature: Record<string, unknown> | null
  } | null
  templateName: string
  subjectLabel: string | null
  items:        RunItem[]
  responses:    RunResponse[]
}

export interface NewRun {
  templateId:   string
  facilityId:   string
  title:        string
  subjectType:  ChecklistSubjectType
  subjectId:    string
  obligationId: string | null
  occurrenceAt: string | null
  jurisdictionKey: string
  libraryVersion:  string
  userId:       string
}

/** Every database operation the two flows need, so the rules above are testable without one. */
export interface RunStore {
  findSubject(type: ChecklistSubjectType, id: string, facilityId: string): Promise<{ label: string } | null>
  getObligation(id: string): Promise<ObligationRow | null>
  findTemplateId(libraryKey: string, instanceKey: string): Promise<string | null>
  createTemplate(rows: TemplateRows): Promise<{ id: string; created: boolean }>
  findOpenRun(args: { templateId: string; facilityId: string; subjectId: string }): Promise<string | null>
  createRun(run: NewRun): Promise<string>

  loadRun(inspectionId: string): Promise<RunSnapshot | null>
  saveResponses(inspectionId: string, responses: RunResponse[]): Promise<void>
  existingFindingRefs(inspectionId: string): Promise<Set<string>>
  insertFindings(findings: NonconformityInsert[]): Promise<void>
  recordCompletion(args: { obligationId: string; occurrenceAt: string; inspectionId: string; userId: string; note: string }): Promise<void>
  advanceObligation(id: string, update: { next_due_at: string } | { status: 'completed' }): Promise<void>
  saveSignature(inspectionId: string, signature: Record<string, unknown>): Promise<void>
  finalize(args: {
    inspectionId: string; score: number; maxScore: number; result: 'pass' | 'fail'; userId: string; submittedAt: string
  }): Promise<boolean>
}

export type Failure = { ok: false; status: number; error: string; detail?: string; missing?: string[] }

// ── start ───────────────────────────────────────────────────────────────────

export interface StartInput {
  libraryKey:   string
  subjectId:    string | null
  obligationId: string | null
  occurrenceAt: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SUBJECT_ID_MAX = 100

export async function startChecklist(
  store: RunStore, site: SiteContext, userId: string, input: StartInput,
): Promise<{ ok: true; inspectionId: string; resumed: boolean } | Failure> {
  const template = site.library.checklists.find(t => t.id === input.libraryKey)
  if (!template) return { ok: false, status: 404, error: 'unknown_template' }
  if (!applies(template.appliesWhen, site.applicability)) {
    return { ok: false, status: 409, error: 'not_applicable', detail: "This checklist does not apply to this site's profile." }
  }

  const rows = buildTemplateRows(template, site.applicability, site.jurisdiction.chain, {
    libraryVersion: libraryVersionLabel(site.library), lastVerified: oldestVerification(site.library),
  })
  if (rows.items.length === 0) {
    return { ok: false, status: 409, error: 'not_applicable', detail: 'No item on this checklist applies to this site.' }
  }

  let subject: { id: string; label: string }
  if (template.subjectType === 'facility') {
    subject = { id: site.facility.id, label: site.facility.name }
  } else {
    if (!input.subjectId || input.subjectId.length > SUBJECT_ID_MAX) {
      return { ok: false, status: 400, error: 'subject_required', detail: `This checklist is run against one ${template.subjectType.replace('_', ' ')}.` }
    }
    const found = await store.findSubject(template.subjectType, input.subjectId, site.facility.id)
    if (!found) return { ok: false, status: 404, error: 'subject_not_found' }
    subject = { id: input.subjectId, label: found.label }
  }

  let occurrenceAt: string | null = null
  if (input.obligationId) {
    const obligation = await store.getObligation(input.obligationId)
    if (!obligation || obligation.facility_id !== site.facility.id) return { ok: false, status: 404, error: 'obligation_not_found' }
    if (obligation.status !== 'open') return { ok: false, status: 409, error: 'obligation_closed' }
    const libraryObligation = obligation.library_key ? site.library.obligations.find(o => o.id === obligation.library_key) : undefined
    if (libraryObligation?.checklistTemplateId && libraryObligation.checklistTemplateId !== template.id) {
      return { ok: false, status: 400, error: 'obligation_checklist_mismatch', detail: 'That deadline is satisfied by a different checklist.' }
    }
    if (input.occurrenceAt !== null && !ISO_DATE.test(input.occurrenceAt)) return { ok: false, status: 400, error: 'invalid_occurrence_date' }
    occurrenceAt = input.occurrenceAt ?? obligation.next_due_at
  }

  const instanceKey = rows.companion.jurisdiction_key
  const templateId = (await store.findTemplateId(template.id, instanceKey)) ?? (await store.createTemplate(rows)).id

  const open = await store.findOpenRun({ templateId, facilityId: site.facility.id, subjectId: subject.id })
  if (open) return { ok: true, inspectionId: open, resumed: true }

  const inspectionId = await store.createRun({
    templateId,
    facilityId:      site.facility.id,
    title:           `${template.name}: ${subject.label}`.slice(0, 200),
    subjectType:     template.subjectType,
    subjectId:       subject.id,
    obligationId:    input.obligationId,
    occurrenceAt,
    jurisdictionKey: instanceKey,
    libraryVersion:  rows.companion.library_version,
    userId,
  })
  return { ok: true, inspectionId, resumed: false }
}

// ── submit ──────────────────────────────────────────────────────────────────

export interface SubmitAnswer {
  itemId:     string
  result:     ResponseResult | null
  value:      unknown
  evidenceId: string | null
  note:       string | null
}

export interface SubmitInput {
  answers:       SubmitAnswer[]
  signatureName: string
  imagePath:     string | null
}

const MAX_ANSWERS = 500
const MAX_TEXT = 2000
const MAX_PATH = 300

/**
 * Validate a submit request body (snake_case). Evidence paths must sit under the
 * caller's tenant folder: they later become signed URLs, so a path into another
 * tenant's folder must never be accepted.
 */
export function parseSubmitBody(body: unknown, tenantId: string): { ok: true; input: SubmitInput } | { ok: false; errors: string[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, errors: ['Expected an object.'] }
  const b = body as Record<string, unknown>
  const errors: string[] = []

  if (b.attested !== true) errors.push('attested must be true: the person submitting confirms the answers are accurate.')
  const name = typeof b.signature_name === 'string' ? b.signature_name.trim() : ''
  if (name.length < 2 || name.length > 120) errors.push('signature_name is required (2-120 characters).')

  const ownPath = (value: unknown, label: string): string | null => {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || value.length > MAX_PATH || !value.startsWith(`${tenantId}/`) || value.includes('..')) {
      errors.push(`${label} must be a file you uploaded to this account.`)
      return null
    }
    return value
  }
  const imagePath = ownPath(b.signature_image_path, 'signature_image_path')

  const answers: SubmitAnswer[] = []
  if (!Array.isArray(b.answers)) {
    errors.push('answers must be a list.')
  } else if (b.answers.length > MAX_ANSWERS) {
    errors.push(`answers has too many entries (the limit is ${MAX_ANSWERS}).`)
  } else {
    const seen = new Set<string>()
    b.answers.forEach((raw, index) => {
      const a = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
      if (typeof a.item_id !== 'string' || a.item_id === '') { errors.push(`answers[${index}].item_id is required.`); return }
      if (seen.has(a.item_id)) { errors.push(`answers[${index}] repeats item ${a.item_id}.`); return }
      seen.add(a.item_id)
      const result = a.result === undefined || a.result === null ? null
        : a.result === 'pass' || a.result === 'fail' || a.result === 'na' ? a.result : undefined
      if (result === undefined) { errors.push(`answers[${index}].result must be pass, fail or na.`); return }
      const value = a.value === undefined ? null : a.value
      const valueOk = value === null || typeof value === 'number' || typeof value === 'boolean'
        || (typeof value === 'string' && value.length <= MAX_TEXT)
      if (!valueOk) { errors.push(`answers[${index}].value must be a number, true/false or text of at most ${MAX_TEXT} characters.`); return }
      if (a.note !== undefined && a.note !== null && (typeof a.note !== 'string' || a.note.length > MAX_TEXT)) {
        errors.push(`answers[${index}].note must be text of at most ${MAX_TEXT} characters.`); return
      }
      answers.push({
        itemId: a.item_id, result, value,
        evidenceId: ownPath(a.evidence_id, `answers[${index}].evidence_id`),
        note: typeof a.note === 'string' ? a.note.trim() || null : null,
      })
    })
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, input: { answers, signatureName: name, imagePath } }
}

const asFailable = (item: RunItem): FailableItem => {
  const config = item.config
  return {
    id: item.id, prompt: item.prompt, itemType: item.item_type, failCreatesAction: item.fail_creates_action,
    critical:  config.critical === true,
    clauseRef: typeof config.clause_ref === 'string' ? config.clause_ref : undefined,
    citations: Array.isArray(config.citations) ? (config.citations as Citation[]) : [],
  }
}

export interface SubmitOutcome {
  ok: true
  result:              'pass' | 'fail'
  score:               number
  maxScore:            number
  pct:                 number
  findingsRaised:      number
  completedObligation: boolean
}

export async function submitChecklist(
  store: RunStore, ctx: { userId: string; now: Date }, inspectionId: string, input: SubmitInput,
): Promise<SubmitOutcome | Failure> {
  const snapshot = await store.loadRun(inspectionId)
  // An inspection that is not an environmental checklist is reported as absent, not forbidden.
  if (!snapshot || snapshot.inspection.domain !== 'environmental' || !snapshot.run) return { ok: false, status: 404, error: 'not_found' }
  if (snapshot.inspection.status === 'submitted') return { ok: false, status: 409, error: 'already_submitted' }

  const itemById = new Map(snapshot.items.map(item => [item.id, item]))
  const unknown = input.answers.filter(a => !itemById.has(a.itemId)).map(a => a.itemId)
  if (unknown.length > 0) return { ok: false, status: 400, error: 'unknown_item', missing: unknown }

  // A numeric reading passes or fails by its limits, as in the generic engine.
  const resolved: SubmitAnswer[] = input.answers.map(answer => {
    const item = itemById.get(answer.itemId)!
    if (answer.result === null && item.item_type === 'numeric' && typeof answer.value === 'number') {
      const limits = item.config as { min?: number; max?: number }
      return { ...answer, result: evaluateNumeric(answer.value, limits.min ?? null, limits.max ?? null) }
    }
    return answer
  })
  const answerLikes: AnswerLike[] = resolved.map(a => ({ itemId: a.itemId, result: a.result, value: a.value, evidenceId: a.evidenceId, note: a.note }))

  const missing = missingRequiredItems(snapshot.items.map(i => ({ id: i.id, itemType: i.item_type, required: i.required })), answerLikes)
  if (missing.length > 0) return { ok: false, status: 400, error: 'missing_required', missing }

  await store.saveResponses(inspectionId, resolved.map(a => ({
    item_id: a.itemId, value: a.value, result: a.result, evidence_id: a.evidenceId, note: a.note,
  })))

  const scored = scoreInspection(
    snapshot.items.map(i => ({ id: i.id, type: i.item_type, weight: Number(i.weight), failCreatesAction: i.fail_creates_action })),
    resolved.map(a => ({ itemId: a.itemId, result: a.result })),
  )

  const obligation = snapshot.run.obligation_id ? await store.getObligation(snapshot.run.obligation_id) : null

  const findings = failuresToNonconformities({
    inspectionId, templateName: snapshot.templateName, subjectLabel: snapshot.subjectLabel,
    facilityId: snapshot.inspection.facility_id,
    items: snapshot.items.map(asFailable), answers: answerLikes,
    identifiedAt: ctx.now.toISOString().slice(0, 10), identifiedBy: ctx.userId,
    ownerUserId: obligation?.owner_user_id ?? null,
  })
  if (findings.length > 0) {
    const already = await store.existingFindingRefs(inspectionId)
    const fresh = findings.filter(f => !already.has(f.source_reference))
    if (fresh.length > 0) await store.insertFindings(fresh)
  }

  // The duty is to inspect, not to pass: a failed run still completes the occurrence.
  let completedObligation = false
  if (obligation && obligation.status === 'open') {
    const occurrenceAt = snapshot.run.occurrence_at ?? obligation.next_due_at
    await store.recordCompletion({
      obligationId: obligation.id, occurrenceAt, inspectionId, userId: ctx.userId,
      note: `Checklist ${scored.result === 'pass' ? 'passed' : 'recorded failures'}`,
    })
    // Advance only while the deadline still sits on the occurrence this run satisfies, so a
    // retry after a partial failure cannot push it a second period.
    if (obligation.next_due_at === occurrenceAt) {
      await store.advanceObligation(obligation.id, obligation.cadence === 'once'
        ? { status: 'completed' }
        : { next_due_at: advanceDueDate(obligation.next_due_at, obligation.cadence, obligation.cadence_days, { clampToMonthEnd: obligation.due_anchor === 'period_end' }) })
    }
    completedObligation = true
  }

  await store.saveSignature(inspectionId, {
    name: input.signatureName, signed_at: ctx.now.toISOString(), ...(input.imagePath ? { image_path: input.imagePath } : {}),
  })
  const flipped = await store.finalize({
    inspectionId, score: scored.score, maxScore: scored.maxScore, result: scored.result,
    userId: ctx.userId, submittedAt: ctx.now.toISOString(),
  })
  if (!flipped) return { ok: false, status: 409, error: 'already_submitted' }

  return {
    ok: true, result: scored.result, score: scored.score, maxScore: scored.maxScore, pct: scored.pct,
    findingsRaised: findings.length, completedObligation,
  }
}
