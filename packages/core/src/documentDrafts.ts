// The contract every LLM-drafted regulatory document goes through. Pure — no
// I/O, no model call.
//
// WHY ONE CONTRACT
// The product already has several bespoke generators (LOTO steps, confined-space
// hazards, toolbox talks, RCA and ECFA assists). Each re-decided provenance,
// review gating, and output shape from scratch, so none of them share a review
// queue and none can be audited the same way. A first-draft service that a
// safety professional relies on needs one answer to: what was generated, from
// what evidence, by which model, who accepted it, and what did they change.
//
// WHY CITATIONS MUST RESOLVE
// This is the highest-liability failure in the whole feature. A method
// statement or risk assessment carrying an invented CFR cite gets signed and
// filed, and the fabrication is discovered by an inspector. The repo already
// has a retrieval layer that returns real chunks with jurisdiction, effective
// date, and source URL (lib/ai/rag.ts). So drafting is retrieve-then-draft, and
// any citation that does not resolve to a chunk actually retrieved for THIS
// draft is stripped before a human ever sees it. A draft with no citations is
// honest; a draft with a plausible wrong one is not.
//
// WHY JURISDICTION IS AN INPUT
// A Cal/OSHA method statement and a UK RAMS are different documents with
// different mandatory sections. Letting the model infer which one it is
// writing from context makes the jurisdiction a silent guess in a legal
// document. The caller states it.

// ──────────────────────────────────────────────────────────────────────────
// Kinds
// ──────────────────────────────────────────────────────────────────────────

export const DOCUMENT_DRAFT_KINDS = [
  'risk_assessment',
  'method_statement',
  'jsa_checklist',
  'incident_report',
] as const

export type DocumentDraftKind = typeof DOCUMENT_DRAFT_KINDS[number]

export function isDocumentDraftKind(value: unknown): value is DocumentDraftKind {
  return typeof value === 'string' && (DOCUMENT_DRAFT_KINDS as readonly string[]).includes(value)
}

export const DOCUMENT_DRAFT_LABELS: Record<DocumentDraftKind, string> = {
  risk_assessment:  'Risk assessment',
  method_statement: 'Method statement (SWMS/RAMS)',
  jsa_checklist:    'JSA checklist',
  incident_report:  'Incident report',
}

// Where an accepted draft lands. Acceptance goes through the module's own
// reviewed write path — the draft service never writes these tables itself.
export const DRAFT_TARGET_MODULE: Record<DocumentDraftKind, string> = {
  risk_assessment:  '/risk',
  method_statement: '/jha',
  jsa_checklist:    '/jha',
  incident_report:  '/incidents',
}

// ──────────────────────────────────────────────────────────────────────────
// Status
// ──────────────────────────────────────────────────────────────────────────

export const DOCUMENT_DRAFT_STATUSES = ['draft', 'accepted', 'discarded'] as const
export type DocumentDraftStatus = typeof DOCUMENT_DRAFT_STATUSES[number]

// Terminal states are terminal. Re-accepting an accepted draft would silently
// create a second live record from one generation, and un-discarding one would
// resurrect content a reviewer rejected.
const ALLOWED_TRANSITIONS: Record<DocumentDraftStatus, readonly DocumentDraftStatus[]> = {
  draft:     ['accepted', 'discarded'],
  accepted:  [],
  discarded: [],
}

export function canTransitionDraft(from: DocumentDraftStatus, to: DocumentDraftStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

// ──────────────────────────────────────────────────────────────────────────
// Citations
// ──────────────────────────────────────────────────────────────────────────

/** A retrieved knowledge chunk, narrowed to what a citation needs. */
export interface RetrievedSource {
  chunkId:       string
  title:         string
  jurisdiction:  string | null
  sourceUrl:     string | null
  effectiveDate: string | null
}

export interface ResolvedCitation {
  chunkId:       string
  title:         string
  jurisdiction:  string | null
  sourceUrl:     string | null
  effectiveDate: string | null
}

export type CitationRejectReason = 'unretrieved_chunk' | 'duplicate'

export interface RejectedCitation {
  chunkId: string
  reason:  CitationRejectReason
}

export interface CitationResolution {
  resolved: ResolvedCitation[]
  rejected: RejectedCitation[]
}

/**
 * Keeps only the citations that point at chunks actually retrieved for this
 * draft.
 *
 * The model is given the retrieved chunks and told to cite by id, so a claimed
 * id outside that set is a fabrication — there is no lookup to fall back to and
 * no benefit of the doubt to extend. Rejections are returned rather than
 * dropped so a run that fabricates heavily is visible instead of merely
 * producing thin drafts.
 */
export function resolveCitations(
  claimedChunkIds: readonly unknown[],
  retrieved: readonly RetrievedSource[],
): CitationResolution {
  const byId = new Map(retrieved.map(s => [s.chunkId, s]))
  const seen = new Set<string>()
  const resolved: ResolvedCitation[] = []
  const rejected: RejectedCitation[] = []

  for (const claimed of claimedChunkIds) {
    if (typeof claimed !== 'string' || claimed.length === 0) {
      rejected.push({ chunkId: String(claimed), reason: 'unretrieved_chunk' })
      continue
    }
    const source = byId.get(claimed)
    if (!source) {
      rejected.push({ chunkId: claimed, reason: 'unretrieved_chunk' })
      continue
    }
    if (seen.has(claimed)) {
      rejected.push({ chunkId: claimed, reason: 'duplicate' })
      continue
    }
    seen.add(claimed)
    resolved.push({ ...source })
  }

  return { resolved, rejected }
}

// ──────────────────────────────────────────────────────────────────────────
// Payload validation
// ──────────────────────────────────────────────────────────────────────────

// Drafts are stored as jsonb, so the type safety has to live somewhere. It
// lives here, on READ as well as write: a draft generated by an older prompt
// version is still in the table when the schema moves, and a reviewer opening
// it must get a clear "this draft predates the current format" rather than a
// crash or a half-rendered document.
export const DOCUMENT_DRAFT_PAYLOAD_VERSION = 1

export interface DraftEnvelope {
  version:      number
  kind:         DocumentDraftKind
  jurisdiction: string
  title:        string
  /** Kind-specific body. Validated by requiredSectionsFor(kind). */
  body:         Record<string, unknown>
  citations:    ResolvedCitation[]
}

// The sections a draft of each kind must carry to be renderable. Kept minimal
// and structural — content quality is the reviewer's job, presence is ours.
const REQUIRED_SECTIONS: Record<DocumentDraftKind, readonly string[]> = {
  risk_assessment:  ['scope', 'hazards', 'existingControls', 'additionalControls'],
  method_statement: ['scope', 'steps', 'ppe', 'emergencyArrangements'],
  jsa_checklist:    ['task', 'steps'],
  incident_report:  ['summary', 'sequence', 'immediateActions'],
}

export function requiredSectionsFor(kind: DocumentDraftKind): readonly string[] {
  return REQUIRED_SECTIONS[kind]
}

export type DraftValidation =
  | { ok: true;  envelope: DraftEnvelope }
  | { ok: false; reason: string }

/**
 * Validates a stored or freshly generated payload against the current format.
 *
 * Returns a reason rather than throwing: both call sites — the generator and
 * the reviewer's read — want to show the operator what is wrong, not surface a
 * stack trace.
 */
export function validateDraftPayload(payload: unknown): DraftValidation {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: 'Draft payload is not an object.' }
  }
  const p = payload as Partial<DraftEnvelope>

  if (p.version !== DOCUMENT_DRAFT_PAYLOAD_VERSION) {
    return {
      ok: false,
      reason: `Draft was written in format v${String(p.version ?? 'unknown')}; this build reads v${DOCUMENT_DRAFT_PAYLOAD_VERSION}.`,
    }
  }
  if (!isDocumentDraftKind(p.kind)) {
    return { ok: false, reason: `Unknown draft kind: ${String(p.kind)}.` }
  }
  if (typeof p.jurisdiction !== 'string' || p.jurisdiction.trim().length === 0) {
    return { ok: false, reason: 'Draft is missing its jurisdiction.' }
  }
  if (typeof p.title !== 'string' || p.title.trim().length === 0) {
    return { ok: false, reason: 'Draft is missing a title.' }
  }
  if (typeof p.body !== 'object' || p.body === null) {
    return { ok: false, reason: 'Draft is missing its body.' }
  }
  if (!Array.isArray(p.citations)) {
    return { ok: false, reason: 'Draft is missing its citation list.' }
  }

  const missing = REQUIRED_SECTIONS[p.kind].filter(section => !(section in p.body!))
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `${DOCUMENT_DRAFT_LABELS[p.kind]} draft is missing: ${missing.join(', ')}.`,
    }
  }

  return { ok: true, envelope: p as DraftEnvelope }
}

// ──────────────────────────────────────────────────────────────────────────
// Provenance
// ──────────────────────────────────────────────────────────────────────────

export interface DraftProvenance {
  /** True when the content came from a model rather than a person. */
  aiOrigin:   boolean
  /** True once a human changed it before accepting. */
  aiEdited:   boolean
  model:      string
  /** How many citations the model claimed that did not resolve. */
  fabricatedCitationCount: number
}

/**
 * A one-line disclosure for the reviewer, stating what they are looking at.
 *
 * Fabricated citations are surfaced, not swallowed. A reviewer who knows the
 * model invented two references reads the rest of the draft differently, and
 * that recalibration is more valuable than a clean-looking document.
 */
export function draftProvenanceNotice(p: DraftProvenance): string {
  if (!p.aiOrigin) return 'Written by a person.'
  const base = `First draft generated by ${p.model}; every line is the reviewer's responsibility.`
  if (p.fabricatedCitationCount === 0) return base
  const n = p.fabricatedCitationCount
  return `${base} ${n} unverifiable citation${n === 1 ? ' was' : 's were'} removed before review — check the remaining references closely.`
}
