// Custom environmental deadlines: what a person enters on the compliance calendar.
// Library deadlines are created by the library; this is for the ones a site adds
// itself (a consent-decree report, a landlord's annual inspection) and for editing
// any deadline's owner, date or reminder window.

import type { ObligationCadence } from '../complianceCalendar'
import { ENV_PROGRAMS, type EnvProgram } from './siteProfile'
import { UUID_PATTERN, isRealDate } from './validation'

export const DEADLINE_CADENCES: readonly ObligationCadence[] = [
  'once', 'monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'triennial', 'quinquennial', 'custom_days',
]
export const DEADLINE_STATUSES = ['open', 'completed', 'dismissed'] as const
export type DeadlineStatus = typeof DEADLINE_STATUSES[number]
export const DUE_ANCHORS = ['fixed', 'period_end'] as const
export type StoredDueAnchor = typeof DUE_ANCHORS[number]

export const DEFAULT_LEAD_DAYS = 30

export interface DeadlineInput {
  facilityId:    string | null
  title:         string
  description:   string | null
  regulatoryRef: string | null
  program:       EnvProgram | null
  cadence:       ObligationCadence
  cadenceDays:   number | null
  nextDueAt:     string
  leadDays:      number
  dueAnchor:     StoredDueAnchor
  ownerUserId:   string | null
  status:        DeadlineStatus
}

export type DeadlineValidation =
  | { ok: true; deadline: DeadlineInput }
  | { ok: false; errors: string[] }

const MAX_CADENCE_DAYS = 3650

/** Validate a deadline request body (snake_case). Fields left out keep their value in `current`. */
export function validateDeadline(input: unknown, current?: DeadlineInput): DeadlineValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['Expected an object.'] }
  const body = input as Record<string, unknown>
  const errors: string[] = []
  const has = (key: string) => key in body

  const text = (key: string, max: number, keep: string | null): string | null => {
    if (!has(key)) return keep
    const v = body[key]
    if (v === null || v === '') return null
    if (typeof v !== 'string') { errors.push(`${key} must be text.`); return keep }
    const t = v.trim()
    if (t.length > max) { errors.push(`${key} is too long (the limit is ${max} characters).`); return keep }
    return t || null
  }
  const uuidOrNull = (key: string, keep: string | null): string | null => {
    if (!has(key)) return keep
    const v = body[key]
    if (v === null || v === '') return null
    if (typeof v === 'string' && UUID_PATTERN.test(v)) return v.toLowerCase()
    errors.push(`${key} must be an id.`)
    return keep
  }

  const title = text('title', 200, current?.title ?? null)
  if (title === null && !errors.some(e => e.startsWith('title'))) errors.push('title is required.')

  let cadence: ObligationCadence = current?.cadence ?? 'annual'
  if (has('cadence')) {
    if (typeof body.cadence === 'string' && (DEADLINE_CADENCES as readonly string[]).includes(body.cadence)) cadence = body.cadence as ObligationCadence
    else errors.push(`cadence must be one of: ${DEADLINE_CADENCES.join(', ')}.`)
  }

  let cadenceDays = current?.cadenceDays ?? null
  if (has('cadence_days')) {
    const v = body.cadence_days
    if (v === null) cadenceDays = null
    else if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_CADENCE_DAYS) cadenceDays = v
    else errors.push(`cadence_days must be a whole number of days from 1 to ${MAX_CADENCE_DAYS}.`)
  }
  if (cadence === 'custom_days' && cadenceDays === null && !errors.some(e => e.startsWith('cadence_days'))) {
    errors.push('cadence_days is required when cadence is custom_days.')
  }

  let nextDueAt = current?.nextDueAt ?? ''
  if (has('next_due_at')) {
    if (typeof body.next_due_at === 'string' && isRealDate(body.next_due_at)) nextDueAt = body.next_due_at
    else errors.push('next_due_at must be a date like 2026-12-31.')
  }
  if (!nextDueAt && !errors.some(e => e.startsWith('next_due_at'))) errors.push('next_due_at is required.')

  let program = current?.program ?? null
  if (has('program')) {
    const v = body.program
    if (v === null || v === '') program = null
    else if (typeof v === 'string' && (ENV_PROGRAMS as readonly string[]).includes(v)) program = v as EnvProgram
    else errors.push(`program must be one of: ${ENV_PROGRAMS.join(', ')}.`)
  }

  let leadDays = current?.leadDays ?? DEFAULT_LEAD_DAYS
  if (has('lead_days')) {
    const v = body.lead_days
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 365) leadDays = v
    else errors.push('lead_days must be a whole number of days from 0 to 365.')
  }

  let dueAnchor: StoredDueAnchor = current?.dueAnchor ?? 'fixed'
  if (has('due_anchor')) {
    if (typeof body.due_anchor === 'string' && (DUE_ANCHORS as readonly string[]).includes(body.due_anchor)) dueAnchor = body.due_anchor as StoredDueAnchor
    else errors.push(`due_anchor must be one of: ${DUE_ANCHORS.join(', ')}.`)
  }

  let status: DeadlineStatus = current?.status ?? 'open'
  if (has('status')) {
    if (typeof body.status === 'string' && (DEADLINE_STATUSES as readonly string[]).includes(body.status)) status = body.status as DeadlineStatus
    else errors.push(`status must be one of: ${DEADLINE_STATUSES.join(', ')}.`)
  }

  const deadline: DeadlineInput = {
    facilityId:    uuidOrNull('facility_id', current?.facilityId ?? null),
    title:         title ?? '',
    description:   text('description', 2000, current?.description ?? null),
    regulatoryRef: text('regulatory_ref', 300, current?.regulatoryRef ?? null),
    program,
    cadence,
    cadenceDays:   cadence === 'custom_days' ? cadenceDays : null,
    nextDueAt,
    leadDays,
    dueAnchor,
    ownerUserId:   uuidOrNull('owner_user_id', current?.ownerUserId ?? null),
    status,
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, deadline }
}

export function toDeadlineRow(deadline: DeadlineInput): Record<string, unknown> {
  return {
    facility_id:    deadline.facilityId,
    title:          deadline.title,
    description:    deadline.description,
    regulatory_ref: deadline.regulatoryRef,
    program:        deadline.program,
    cadence:        deadline.cadence,
    cadence_days:   deadline.cadenceDays,
    next_due_at:    deadline.nextDueAt,
    lead_days:      deadline.leadDays,
    due_anchor:     deadline.dueAnchor,
    owner_user_id:  deadline.ownerUserId,
    status:         deadline.status,
  }
}

export function parseDeadlineRow(row: Record<string, unknown>): DeadlineInput {
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    facilityId:    str(row.facility_id),
    title:         String(row.title ?? ''),
    description:   str(row.description),
    regulatoryRef: str(row.regulatory_ref),
    program:       (ENV_PROGRAMS as readonly string[]).includes(row.program as string) ? (row.program as EnvProgram) : null,
    cadence:       row.cadence as ObligationCadence,
    cadenceDays:   typeof row.cadence_days === 'number' ? row.cadence_days : null,
    nextDueAt:     String(row.next_due_at ?? ''),
    leadDays:      typeof row.lead_days === 'number' ? row.lead_days : DEFAULT_LEAD_DAYS,
    dueAnchor:     row.due_anchor === 'period_end' ? 'period_end' : 'fixed',
    ownerUserId:   str(row.owner_user_id),
    status:        (DEADLINE_STATUSES as readonly string[]).includes(row.status as string) ? (row.status as DeadlineStatus) : 'open',
  }
}
