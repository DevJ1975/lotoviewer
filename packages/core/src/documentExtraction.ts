// Environmental document reader: the rules around reviewing a proposal.
//
// The Python service (services/sds-parser, app/documents) reads an uploaded
// permit / manifest / SWPPP and stores a PROPOSAL in document_extractions
// (migration 296). Nothing in a proposal is a record until a tenant admin
// approves it. This module is the pure part of that review: parsing what the
// service stored, validating what the reviewer accepted, and deciding which
// accepted fields become compliance-calendar obligations.

export const DOCUMENT_TYPES = [
  'hazardous_waste_manifest',
  'stormwater_permit',
  'swppp',
  'air_permit',
  'wastewater_permit',
  'monitoring_report',
  'other',
] as const
export type DocumentType = typeof DOCUMENT_TYPES[number]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  hazardous_waste_manifest: 'Hazardous waste manifest',
  stormwater_permit:        'Stormwater permit',
  swppp:                    'Stormwater pollution prevention plan',
  air_permit:               'Air permit',
  wastewater_permit:        'Wastewater permit',
  monitoring_report:        'Monitoring report',
  other:                    'Unrecognized document',
}

/** Private storage bucket for uploaded documents (migration 296). */
export const ENVIRONMENTAL_DOCS_BUCKET = 'environmental-docs'

/** Object key for a document: the tenant prefix is what the database CHECK enforces. */
export function environmentalDocumentPath(tenantId: string, documentId: string): string {
  return `${tenantId}/${documentId}.pdf`
}

export const DOCUMENT_STATUSES = ['processing', 'needs_review', 'approved', 'rejected', 'failed'] as const
export type DocumentStatus = typeof DOCUMENT_STATUSES[number]

export type ExtractionConfidence = 'high' | 'medium' | 'low'

export interface ProposedField {
  key:        string
  label:      string
  value:      string
  confidence: ExtractionConfidence
  /** A short snippet of the document the value came from. */
  evidence:   string
  /** True when OCR look-alike characters were corrected (0/O, 1/I, 5/S, 8/B). */
  repaired:   boolean
}

export interface DocumentProposal {
  docType:           DocumentType
  docTypeConfidence: ExtractionConfidence
  overallConfidence: ExtractionConfidence
  viaOcr:            boolean
  notes:             string
  fields:            ProposedField[]
}

/** A field the reviewer confirmed, possibly after correcting its value. */
export interface ReviewedField {
  key:    string
  label:  string
  value:  string
  edited: boolean
}

export const MAX_ACCEPTED_FIELDS = 100
export const MAX_FIELD_VALUE_LENGTH = 200

const CONFIDENCES: readonly string[] = ['high', 'medium', 'low']

function isConfidence(v: unknown): v is ExtractionConfidence {
  return typeof v === 'string' && CONFIDENCES.includes(v)
}

function isDocumentType(v: unknown): v is DocumentType {
  return typeof v === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(v)
}

/** A real calendar date in YYYY-MM-DD form ("2027-02-30" is not one). */
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/**
 * Read a proposal back out of the stored row. The columns hold what the
 * service wrote, but they are jsonb to this code, so nothing is assumed: a
 * malformed field is dropped rather than rendered, and a row with no usable
 * shape yields null.
 */
export function parseProposal(row: {
  doc_type?: unknown; doc_type_confidence?: unknown; overall_confidence?: unknown
  via_ocr?: unknown; extraction?: unknown
}): DocumentProposal | null {
  const extraction = row.extraction
  if (typeof extraction !== 'object' || extraction === null || Array.isArray(extraction)) return null
  const e = extraction as Record<string, unknown>

  const fields: ProposedField[] = []
  for (const raw of Array.isArray(e.fields) ? e.fields : []) {
    if (typeof raw !== 'object' || raw === null) continue
    const f = raw as Record<string, unknown>
    if (typeof f.key !== 'string' || typeof f.value !== 'string' || !isConfidence(f.confidence)) continue
    fields.push({
      key:        f.key,
      label:      typeof f.label === 'string' ? f.label : f.key,
      value:      f.value,
      confidence: f.confidence,
      evidence:   typeof f.evidence === 'string' ? f.evidence : '',
      repaired:   f.repaired === true,
    })
  }

  return {
    docType:           isDocumentType(row.doc_type) ? row.doc_type : 'other',
    docTypeConfidence: isConfidence(row.doc_type_confidence) ? row.doc_type_confidence : 'low',
    overallConfidence: isConfidence(row.overall_confidence) ? row.overall_confidence : 'low',
    viaOcr:            row.via_ocr === true,
    notes:             typeof e.notes === 'string' ? e.notes : '',
    fields,
  }
}

/**
 * Which proposed fields start ticked in the review screen. Anything from a scan,
 * anything OCR "repaired", and anything the extractor was unsure of starts
 * UNticked, so approving it takes a deliberate act per value.
 */
export function defaultAcceptedIndices(proposal: DocumentProposal): number[] {
  if (proposal.viaOcr) return []
  const indices: number[] = []
  proposal.fields.forEach((f, i) => {
    if (f.confidence !== 'low' && !f.repaired) indices.push(i)
  })
  return indices
}

export type ReviewResult =
  | { ok: true;  fields: ReviewedField[] }
  | { ok: false; error: string }

/**
 * Validate what the reviewer ticked. Accepted fields are referenced by their
 * position in the proposal, so a client can only confirm (or correct) a field
 * the service actually found, never invent one. Date fields must be real dates.
 */
export function reviewAcceptedFields(proposal: DocumentProposal, accepted: unknown): ReviewResult {
  if (!Array.isArray(accepted) || accepted.length === 0) {
    return { ok: false, error: 'Select at least one field to approve.' }
  }
  if (accepted.length > MAX_ACCEPTED_FIELDS) {
    return { ok: false, error: `Too many fields (the limit is ${MAX_ACCEPTED_FIELDS}).` }
  }

  const seen = new Set<number>()
  const fields: ReviewedField[] = []
  for (const item of accepted) {
    const { index, value } = (item ?? {}) as { index?: unknown; value?: unknown }
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= proposal.fields.length) {
      return { ok: false, error: 'A selected field is not part of this document.' }
    }
    if (seen.has(index)) return { ok: false, error: 'A field was selected twice.' }
    seen.add(index)

    const proposed = proposal.fields[index]
    if (typeof value !== 'string') return { ok: false, error: `"${proposed.label}" needs a value.` }
    const trimmed = value.trim()
    if (!trimmed) return { ok: false, error: `"${proposed.label}" needs a value.` }
    if (trimmed.length > MAX_FIELD_VALUE_LENGTH) {
      return { ok: false, error: `"${proposed.label}" is too long (the limit is ${MAX_FIELD_VALUE_LENGTH} characters).` }
    }
    if (proposed.key.endsWith('_date') && !isIsoDate(trimmed)) {
      return { ok: false, error: `"${proposed.label}" must be a real date in YYYY-MM-DD form.` }
    }
    fields.push({ key: proposed.key, label: proposed.label, value: trimmed, edited: trimmed !== proposed.value })
  }
  return { ok: true, fields }
}

/** What approving would add to the compliance calendar (tenant-source obligations). */
export interface ObligationDraft {
  title:       string
  description: string
  next_due_at: string
  cadence:     'once'
  category:    'environmental'
  /** Back-reference to the source document, stored in the obligation's evidence_id. */
  evidence_id: string
}

const IDENTIFIER_KEYS = [
  'permit_number', 'npdes_permit_id', 'tpdes_stormwater_authorization', 'tceq_wastewater_permit',
] as const

const MAX_TITLE_LENGTH = 200

/**
 * The calendar entries an approval proposes: one per confirmed expiration date
 * and one per confirmed renewal-due date. The renewal date is the document's own
 * (we do not guess how early a permit must be renewed), and every entry names
 * its source document so a person can find where the date came from.
 */
export function planObligations(
  reviewed: readonly ReviewedField[],
  source: { documentId: string; docType: DocumentType; fileName: string },
): ObligationDraft[] {
  const identifier = IDENTIFIER_KEYS
    .map(key => reviewed.find(f => f.key === key)?.value)
    .find((v): v is string => !!v)
  const subject = DOCUMENT_TYPE_LABELS[source.docType] + (identifier ? ` ${identifier}` : '')

  const drafts: ObligationDraft[] = []
  const seen = new Set<string>()
  for (const f of reviewed) {
    const title =
      f.key === 'expiration_date'  ? `${subject} expires` :
      f.key === 'renewal_due_date' ? `Submit renewal: ${subject}` :
      null
    if (!title || !isIsoDate(f.value)) continue

    const id = `${title}|${f.value}`
    if (seen.has(id)) continue
    seen.add(id)

    drafts.push({
      title:       title.slice(0, MAX_TITLE_LENGTH),
      description: `Added from the uploaded document "${source.fileName}". How early a renewal must be filed varies by permit: check the permit's own conditions.`,
      next_due_at: f.value,
      cadence:     'once',
      category:    'environmental',
      evidence_id: `document_extractions:${source.documentId}`,
    })
  }
  return drafts
}
