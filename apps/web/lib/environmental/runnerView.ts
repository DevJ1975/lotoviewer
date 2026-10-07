import { evaluateNumeric } from '@soteria/core/inspectionScoring'
import { ENV_PROGRAMS, type EnvProgram } from '@soteria/core/environmental/siteProfile'
import type { ChecklistTemplateRow, RunItemView, SubmitBody } from './client'

// The checklist screens' logic without the screen: what counts as answered, what
// blocks submitting, the request body, and the local draft. Mirrors the server's
// own rules (checklists.ts isAnswered) so the screen never lets someone press
// Submit on something the server will refuse, and never hides what it refuses.

export interface Answer {
  /** pass / fail / na for pass-fail questions. */
  result: 'pass' | 'fail' | 'na' | null
  /** Text for text/signature questions, the typed number for numeric ones. */
  value: string
  evidencePath: string | null
  note: string
}

export const EMPTY_ANSWER: Answer = { result: null, value: '', evidencePath: null, note: '' }

export type Answers = Readonly<Record<string, Answer>>

const answerOf = (answers: Answers, id: string): Answer => answers[id] ?? EMPTY_ANSWER

/** The numeric reading, or null when the box is empty or not a finite number. */
export function numericValue(text: string): number | null {
  if (text.trim() === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

export function isAnswered(item: RunItemView, answers: Answers): boolean {
  const a = answerOf(answers, item.id)
  switch (item.item_type) {
    case 'pass_fail_na':
      return a.result !== null
    case 'multiple_choice':
    case 'text':
      return a.value.trim() !== ''
    case 'numeric':
      return numericValue(a.value) !== null
    case 'photo':
      return a.evidencePath !== null
    case 'signature':
      return a.value.trim() !== '' || a.evidencePath !== null
  }
}

export interface Progress {
  answered: number
  total: number
  requiredAnswered: number
  requiredTotal: number
  /** Required items still unanswered, in checklist order, for "jump to" links. */
  missing: RunItemView[]
}

export function progress(items: readonly RunItemView[], answers: Answers): Progress {
  const required = items.filter(i => i.required)
  const missing = required.filter(i => !isAnswered(i, answers))
  return {
    answered: items.filter(i => isAnswered(i, answers)).length,
    total: items.length,
    requiredAnswered: required.length - missing.length,
    requiredTotal: required.length,
    missing,
  }
}

/** Whether a numeric reading is inside its limits; null when there is no reading or no limit. */
export function numericVerdict(item: RunItemView, text: string): 'pass' | 'fail' | null {
  const n = numericValue(text)
  if (n === null || (item.min === null && item.max === null)) return null
  const verdict = evaluateNumeric(n, item.min, item.max)
  return verdict === 'na' ? null : verdict
}

/** A human reading of the limits, such as "6 to 9 pH", "at most 5 gpm" or "at least 2". */
export function limitsText(item: RunItemView): string | null {
  const unit = item.unit ? ` ${item.unit}` : ''
  if (item.min !== null && item.max !== null) return `${item.min} to ${item.max}${unit}`
  if (item.max !== null) return `at most ${item.max}${unit}`
  if (item.min !== null) return `at least ${item.min}${unit}`
  return null
}

export function groupBySection(items: readonly RunItemView[]): Array<{ section: string; items: RunItemView[] }> {
  const groups: Array<{ section: string; items: RunItemView[] }> = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.section === item.section) last.items.push(item)
    else groups.push({ section: item.section, items: [item] })
  }
  return groups
}

/**
 * The request body. Unanswered optional items are left out; a number is sent as a
 * number; a numeric item sends no result, so the server judges the reading against
 * the item's limits and the screen cannot disagree with it.
 */
export function toSubmitBody(
  items: readonly RunItemView[], answers: Answers, signature: { name: string; imagePath: string | null },
): SubmitBody {
  const out: SubmitBody['answers'] = []
  for (const item of items) {
    if (!isAnswered(item, answers) && answerOf(answers, item.id).note.trim() === '') continue
    const a = answerOf(answers, item.id)
    const note = a.note.trim() || null
    switch (item.item_type) {
      case 'pass_fail_na':
        out.push({ item_id: item.id, result: a.result, note, evidence_id: a.evidencePath }); break
      case 'numeric':
        out.push({ item_id: item.id, value: numericValue(a.value), note, evidence_id: a.evidencePath }); break
      case 'photo':
        out.push({ item_id: item.id, evidence_id: a.evidencePath, note }); break
      default:
        out.push({ item_id: item.id, value: a.value.trim(), evidence_id: a.evidencePath, note })
    }
  }
  return { attested: true, signature_name: signature.name.trim(), ...(signature.imagePath ? { signature_image_path: signature.imagePath } : {}), answers: out }
}

// ── local draft ─────────────────────────────────────────────────────────────

export interface Draft { answers: Record<string, Answer>; signatureName: string }

export const draftKey = (inspectionId: string) => `env-checklist-draft:${inspectionId}`

export function serializeDraft(draft: Draft): string {
  return JSON.stringify(draft)
}

/** A stored draft, or null if it is missing, damaged or from something else. Drafts are a convenience, never trusted. */
export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { answers?: unknown; signatureName?: unknown }
    if (typeof parsed.answers !== 'object' || parsed.answers === null || Array.isArray(parsed.answers)) return null
    const answers: Record<string, Answer> = {}
    for (const [id, value] of Object.entries(parsed.answers as Record<string, unknown>)) {
      const a = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
      answers[id] = {
        result: a.result === 'pass' || a.result === 'fail' || a.result === 'na' ? a.result : null,
        value: typeof a.value === 'string' ? a.value : '',
        evidencePath: typeof a.evidencePath === 'string' ? a.evidencePath : null,
        note: typeof a.note === 'string' ? a.note : '',
      }
    }
    return { answers, signatureName: typeof parsed.signatureName === 'string' ? parsed.signatureName : '' }
  } catch {
    return null
  }
}

// ── the checklist list ──────────────────────────────────────────────────────

/** Templates grouped by program in the library's program order, empty programs omitted. */
export function groupByProgram(templates: readonly ChecklistTemplateRow[]): Array<{ program: EnvProgram; templates: ChecklistTemplateRow[] }> {
  return ENV_PROGRAMS
    .map(program => ({ program, templates: templates.filter(t => t.program === program) }))
    .filter(group => group.templates.length > 0)
}

/** "Never done", "Last done 2026-06-30, next due 2026-09-30", "Overdue since 2026-09-30". */
export function dueText(t: Pick<ChecklistTemplateRow, 'due_status' | 'last_completed_on' | 'due_on'>): string {
  if (t.due_status === 'never') return 'Not done yet'
  const last = t.last_completed_on ? `Last done ${t.last_completed_on}` : null
  const next = t.due_on ? (t.due_status === 'overdue' ? `overdue since ${t.due_on}` : `next due ${t.due_on}`) : null
  return [last, next].filter(Boolean).join(', ') || 'Done'
}

/** Checklists run against a thing at the site (an outfall) need it chosen first. */
export const needsSubject = (t: Pick<ChecklistTemplateRow, 'subject_type'>) => t.subject_type === 'outfall' || t.subject_type === 'permit'
