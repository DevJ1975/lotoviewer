import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FieldError } from '@soteria/core/hazardousWaste'
import { validateRetirementReason } from '@soteria/core/managementSystem'
import { sanitizeError } from '@/lib/security/sanitizeError'
import type { Parsed } from './contextRegisters'
import { EMS_DISCIPLINES, UUID_RE, notFound, text } from './registerApi'
import { EVIDENCE_KINDS, EVIDENCE_SUBJECT_TYPES, type EvidenceKind, type EvidenceSubjectType } from './evidence'

// What a file of evidence is attached to, and who may attach it (Phase 2
// plan D15, D16). Migration 306's trigger enforces the seals as well; this
// lets the upload routes refuse before a file is stored, with a plain reason.

export interface EvidenceSubject {
  /** The site the evidence belongs to, copied onto the ms_evidence row. */
  facilityId:   string | null
  /** True once the subject takes no more evidence. */
  sealed:       boolean
  /** Why it is sealed, in plain words; also the answer when it seals while a file is in flight. */
  sealedReason: string
  /** Besides admins, the one person who may attach: an evaluation's assignee, or a condition's owner. */
  alsoAllowed:  string | null
}

type Resolved = { subject: EvidenceSubject | null; error: unknown }

const SEALED = {
  compliance_evaluation:     'This evaluation is complete; its evidence is sealed with it.',
  environmental_permit:      'This permit is retired, so its documents can no longer change.',
  ms_change_impact:          'This impact is resolved, or its change has ended, so its evidence can no longer change.',
  compliance_calendar_event: 'This occurrence takes no more evidence.',
  compliance_obligation:     'This obligation takes no more evidence.',
} as const satisfies Record<EvidenceSubjectType, string>

/** The subject when it exists in the caller's tenant (and, for obligations, the environmental register); else null. */
export async function resolveEvidenceSubject(
  client: SupabaseClient,
  tenantId: string,
  subjectType: EvidenceSubjectType,
  subjectId: string,
): Promise<Resolved> {
  const subject = (fields: Omit<EvidenceSubject, 'sealedReason'>): EvidenceSubject =>
    ({ ...fields, sealedReason: SEALED[subjectType] })

  switch (subjectType) {
    case 'compliance_evaluation': {
      const { data, error } = await client.from('ms_compliance_evaluations')
        .select('facility_id, assigned_to, completed_at')
        .eq('id', subjectId).eq('tenant_id', tenantId).maybeSingle()
      if (error || !data) return { subject: null, error }
      const row = data as { facility_id: string | null; assigned_to: string | null; completed_at: string | null }
      return { subject: subject({ facilityId: row.facility_id, sealed: row.completed_at !== null, alsoAllowed: row.assigned_to }), error: null }
    }
    case 'environmental_permit': {
      const { data, error } = await client.from('environmental_permits')
        .select('facility_id, retired_at')
        .eq('id', subjectId).eq('tenant_id', tenantId).maybeSingle()
      if (error || !data) return { subject: null, error }
      const row = data as { facility_id: string; retired_at: string | null }
      return { subject: subject({ facilityId: row.facility_id, sealed: row.retired_at !== null, alsoAllowed: null }), error: null }
    }
    case 'ms_change_impact': {
      const { data, error } = await client.from('ms_change_impacts')
        .select('change_id, resolved_at')
        .eq('id', subjectId).eq('tenant_id', tenantId).maybeSingle()
      if (error || !data) return { subject: null, error }
      const impact = data as { change_id: string; resolved_at: string | null }
      const change = await client.from('ms_changes')
        .select('facility_id, status')
        .eq('id', impact.change_id).eq('tenant_id', tenantId).maybeSingle()
      if (change.error || !change.data) return { subject: null, error: change.error }
      const row = change.data as { facility_id: string | null; status: string }
      return {
        subject: subject({ facilityId: row.facility_id, sealed: impact.resolved_at !== null || row.status !== 'open', alsoAllowed: null }),
        error: null,
      }
    }
    case 'compliance_calendar_event': {
      const { data, error } = await client.from('compliance_calendar_events')
        .select('obligation_id')
        .eq('id', subjectId).eq('tenant_id', tenantId).maybeSingle()
      if (error || !data) return { subject: null, error }
      const obligation = await readObligation(client, tenantId, (data as { obligation_id: string }).obligation_id)
      if (obligation.error || !obligation.row) return { subject: null, error: obligation.error }
      // Proof a condition was done comes from whoever does it: its owner may attach, as they may record it.
      return { subject: subject({ facilityId: obligation.row.facility_id, sealed: false, alsoAllowed: obligation.row.owner_user_id }), error: null }
    }
    case 'compliance_obligation': {
      const obligation = await readObligation(client, tenantId, subjectId)
      if (obligation.error || !obligation.row) return { subject: null, error: obligation.error }
      return { subject: subject({ facilityId: obligation.row.facility_id, sealed: false, alsoAllowed: null }), error: null }
    }
  }
}

async function readObligation(client: SupabaseClient, tenantId: string, id: string) {
  const { data, error } = await client.from('compliance_calendar_obligations')
    .select('facility_id, owner_user_id')
    .eq('id', id).eq('tenant_id', tenantId).in('discipline', EMS_DISCIPLINES).maybeSingle()
  return { row: data as { facility_id: string | null; owner_user_id: string | null } | null, error }
}

// ── The fields every upload route reads ──────────────────────────────────

export interface EvidenceFields {
  subjectType:      EvidenceSubjectType
  subjectId:        string
  kind:             EvidenceKind
  exportControlled: boolean
  supersedes:       { id: string; reason: string } | null
}

/** True/false from a form field ('true'/'false') or a JSON body (true/false); absent is false. */
function flag(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '' || value === false || value === 'false') return false
  if (value === true || value === 'true') return true
  return null
}

/**
 * The subject, kind, export-control flag and replaced file of an upload,
 * from a multipart form (form.get) or a JSON body (body[name]).
 */
export function evidenceFieldsFrom(get: (name: string) => unknown): Parsed<EvidenceFields> {
  const subjectType = text(get('subject_type'))
  const subjectId = text(get('subject_id'))
  const kind = text(get('kind'))
  const exportControlled = flag(get('export_controlled'))
  const supersedesId = text(get('supersedes_id'))
  const supersededReason = text(get('superseded_reason'))

  const errors: FieldError[] = []
  if (!(EVIDENCE_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
    errors.push({ field: 'subjectType', message: `must be one of ${EVIDENCE_SUBJECT_TYPES.join(', ')}` })
  }
  if (!UUID_RE.test(subjectId)) errors.push({ field: 'subjectId', message: 'must be the id of the record the file proves' })
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) {
    errors.push({ field: 'kind', message: `must be one of ${EVIDENCE_KINDS.join(', ')}` })
  }
  if (exportControlled === null) errors.push({ field: 'exportControlled', message: 'must be true or false' })
  if (supersedesId) {
    if (!UUID_RE.test(supersedesId)) errors.push({ field: 'supersedesId', message: 'must be an evidence id' })
    errors.push(...validateRetirementReason(supersededReason, 'supersededReason'))
  }
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    input: {
      subjectType:      subjectType as EvidenceSubjectType,
      subjectId,
      kind:             kind as EvidenceKind,
      exportControlled: exportControlled === true,
      supersedes:       supersedesId ? { id: supersedesId, reason: supersededReason } : null,
    },
  }
}

// ── Who may attach ───────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(['owner', 'admin', 'superadmin'])

const WHO_MAY_ATTACH: Readonly<Record<EvidenceSubjectType, string>> = {
  compliance_evaluation:     'Only an admin or the assigned evaluator can attach evidence to this evaluation.',
  environmental_permit:      'Only an admin can attach documents to a permit.',
  ms_change_impact:          'Only an admin can attach evidence to a change.',
  compliance_calendar_event: 'Only an admin or the condition\'s owner can attach evidence to this occurrence.',
  compliance_obligation:     'Only an admin can attach the text of an obligation.',
}

export interface EvidenceGate {
  tenantId:     string
  userId:       string
  role:         string
  authedClient: SupabaseClient
}

/**
 * The subject an upload attaches to, once it is known to exist in the
 * caller's tenant, to be open, and to be the caller's to attach to. Read
 * through the caller's client, so RLS decides what they can see.
 */
export async function evidenceSubjectFor(
  gate: EvidenceGate,
  fields: Pick<EvidenceFields, 'subjectType' | 'subjectId'>,
  route: string,
): Promise<{ ok: true; subject: EvidenceSubject } | { ok: false; response: NextResponse }> {
  const { subject, error } = await resolveEvidenceSubject(gate.authedClient, gate.tenantId, fields.subjectType, fields.subjectId)
  if (error) return { ok: false, response: sanitizeError(error, `${route} subject`) }
  if (!subject) return { ok: false, response: notFound() }
  if (subject.sealed) return { ok: false, response: NextResponse.json({ error: subject.sealedReason }, { status: 409 }) }
  if (!ADMIN_ROLES.has(gate.role) && subject.alsoAllowed !== gate.userId) {
    return { ok: false, response: NextResponse.json({ error: WHO_MAY_ATTACH[fields.subjectType] }, { status: 403 }) }
  }
  return { ok: true, subject }
}
