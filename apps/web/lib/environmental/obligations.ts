import type { FieldError } from '@soteria/core/hazardousWaste'
import { OBLIGATION_CADENCES, type ObligationCadence } from '@soteria/core/complianceCalendar'
import {
  validateObligationRegisterInput,
  type ObligationRegisterInput,
  type ObligationSourceKind,
} from '@soteria/core/complianceEvaluation'
import { isCalendarDate, type Discipline } from '@soteria/core/managementSystem'
import type { Parsed } from './contextRegisters'
import { emsDisciplineErrors, optionalText, text, type JsonObject } from './registerApi'

// The compliance obligations register (clause 6.1.3) is the compliance
// calendar seen as a legal register (plan D4): the calendar's deadline
// fields say when something is due, the register fields say what the
// obligation is and how often compliance with it is checked.

/** Body columns a register edit may change, and the input field each one feeds. */
export const OBLIGATION_EDITABLE = {
  discipline:              'discipline',
  title:                   'title',
  source_kind:             'sourceKind',
  regulatory_ref:          'citation',
  jurisdiction:            'jurisdiction',
  applicability_rationale: 'applicabilityRationale',
  evaluation_cadence_days: 'evaluationCadenceDays',
} as const satisfies Record<string, keyof ObligationRegisterFields>

export interface ObligationRegisterFields extends ObligationRegisterInput {
  discipline: Discipline
}

/** The core names the citation for what it is; the calendar stores it as regulatory_ref. */
function asColumnNames(errors: FieldError[]): FieldError[] {
  return errors.map(e => (e.field === 'citation' ? { ...e, field: 'regulatoryRef' } : e))
}

/** Absent or null means "never auto-scheduled"; anything but a JSON number fails validation. */
function optionalCadence(value: unknown): number | null {
  if (value === undefined || value === null) return null
  return typeof value === 'number' ? value : Number.NaN
}

export function obligationRegisterInputFrom(raw: JsonObject): Parsed<ObligationRegisterFields> {
  const input: ObligationRegisterFields = {
    discipline:             text(raw.discipline) as Discipline,
    title:                  text(raw.title),
    sourceKind:             text(raw.source_kind) as ObligationSourceKind,
    citation:               optionalText(raw.regulatory_ref),
    jurisdiction:           optionalText(raw.jurisdiction),
    applicabilityRationale: optionalText(raw.applicability_rationale),
    evaluationCadenceDays:  optionalCadence(raw.evaluation_cadence_days),
  }
  const errors = [...asColumnNames(validateObligationRegisterInput(input)), ...emsDisciplineErrors(input.discipline)]
  return errors.length === 0 ? { ok: true, input } : { ok: false, errors }
}

export interface ObligationDeadline {
  nextDueAt:   string
  cadence:     ObligationCadence
  cadenceDays: number | null
}

/**
 * The calendar fields a new obligation needs: the calendar tracks every
 * obligation's next deadline, so a register entry must name one.
 */
export function obligationDeadlineFrom(raw: JsonObject): Parsed<ObligationDeadline> {
  const errors: FieldError[] = []
  const nextDueAt = text(raw.next_due_at)
  if (!isCalendarDate(nextDueAt)) errors.push({ field: 'nextDueAt', message: 'is required: a date (YYYY-MM-DD)' })

  const cadence = (optionalText(raw.cadence) ?? 'annual') as ObligationCadence
  if (!OBLIGATION_CADENCES.includes(cadence)) {
    errors.push({ field: 'cadence', message: `must be one of ${OBLIGATION_CADENCES.join(', ')}` })
  }
  let cadenceDays: number | null = null
  if (cadence === 'custom_days') {
    cadenceDays = typeof raw.cadence_days === 'number' ? raw.cadence_days : Number.NaN
    if (!Number.isInteger(cadenceDays) || cadenceDays < 1) {
      errors.push({ field: 'cadenceDays', message: 'must be a whole number of days when cadence is custom_days' })
    }
  }
  return errors.length === 0 ? { ok: true, input: { nextDueAt, cadence, cadenceDays } } : { ok: false, errors }
}
