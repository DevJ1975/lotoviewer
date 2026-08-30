import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_DRAFT_KINDS,
  DOCUMENT_DRAFT_LABELS,
  DOCUMENT_DRAFT_PAYLOAD_VERSION,
  DRAFT_TARGET_MODULE,
  canTransitionDraft,
  draftProvenanceNotice,
  isDocumentDraftKind,
  requiredSectionsFor,
  resolveCitations,
  validateDraftPayload,
  type RetrievedSource,
} from '../documentDrafts'

// Citation resolution is the whole liability argument for letting a model draft
// a regulatory document. A draft with no citations is honest; a draft with a
// plausible wrong one gets signed and found by an inspector.

const source = (id: string): RetrievedSource => ({
  chunkId:       id,
  title:         '29 CFR 1910.147 — Control of hazardous energy',
  jurisdiction:  'US-Federal',
  sourceUrl:     'https://example.test/1910.147',
  effectiveDate: '2024-01-01',
})

describe('kind catalog', () => {
  it('covers every kind with a label and a target module', () => {
    for (const kind of DOCUMENT_DRAFT_KINDS) {
      expect(DOCUMENT_DRAFT_LABELS[kind]).toBeTruthy()
      expect(DRAFT_TARGET_MODULE[kind]).toMatch(/^\//)
      expect(requiredSectionsFor(kind).length).toBeGreaterThan(0)
    }
  })

  it('covers the four document types the goal names', () => {
    expect([...DOCUMENT_DRAFT_KINDS]).toEqual([
      'risk_assessment', 'method_statement', 'jsa_checklist', 'incident_report',
    ])
  })

  it('rejects an unknown kind', () => {
    expect(isDocumentDraftKind('permit')).toBe(false)
  })
})

describe('resolveCitations', () => {
  const retrieved = [source('chunk-a'), source('chunk-b')]

  it('keeps citations that point at retrieved chunks', () => {
    const { resolved, rejected } = resolveCitations(['chunk-a', 'chunk-b'], retrieved)
    expect(resolved.map(r => r.chunkId)).toEqual(['chunk-a', 'chunk-b'])
    expect(rejected).toEqual([])
  })

  it('strips a fabricated citation', () => {
    // The model was handed the retrieved chunks and told to cite by id, so an
    // id outside that set is invention — there is no lookup to fall back to.
    const { resolved, rejected } = resolveCitations(['chunk-a', 'chunk-invented'], retrieved)
    expect(resolved.map(r => r.chunkId)).toEqual(['chunk-a'])
    expect(rejected).toEqual([{ chunkId: 'chunk-invented', reason: 'unretrieved_chunk' }])
  })

  it('reports fabrications instead of silently thinning the draft', () => {
    const { resolved, rejected } = resolveCitations(['x', 'y', 'z'], retrieved)
    expect(resolved).toEqual([])
    expect(rejected).toHaveLength(3)
  })

  it('carries jurisdiction and source URL through to the citation', () => {
    const [citation] = resolveCitations(['chunk-a'], retrieved).resolved
    expect(citation.jurisdiction).toBe('US-Federal')
    expect(citation.sourceUrl).toBe('https://example.test/1910.147')
    expect(citation.effectiveDate).toBe('2024-01-01')
  })

  it('collapses a repeated citation', () => {
    const { resolved, rejected } = resolveCitations(['chunk-a', 'chunk-a'], retrieved)
    expect(resolved).toHaveLength(1)
    expect(rejected).toEqual([{ chunkId: 'chunk-a', reason: 'duplicate' }])
  })

  it('rejects non-string citation ids', () => {
    const { resolved, rejected } = resolveCitations([null, 42, ''], retrieved)
    expect(resolved).toEqual([])
    expect(rejected).toHaveLength(3)
  })

  it('rejects everything when nothing was retrieved', () => {
    // No retrieval means no grounding; every citation is unverifiable.
    expect(resolveCitations(['chunk-a'], []).resolved).toEqual([])
  })
})

describe('status machine', () => {
  it('lets a draft be accepted or discarded', () => {
    expect(canTransitionDraft('draft', 'accepted')).toBe(true)
    expect(canTransitionDraft('draft', 'discarded')).toBe(true)
  })

  it('makes acceptance terminal', () => {
    // Re-accepting would create a second live record from one generation.
    expect(canTransitionDraft('accepted', 'accepted')).toBe(false)
    expect(canTransitionDraft('accepted', 'discarded')).toBe(false)
  })

  it('does not resurrect a discarded draft', () => {
    expect(canTransitionDraft('discarded', 'draft')).toBe(false)
    expect(canTransitionDraft('discarded', 'accepted')).toBe(false)
  })
})

describe('validateDraftPayload', () => {
  const valid = {
    version:      DOCUMENT_DRAFT_PAYLOAD_VERSION,
    kind:         'method_statement',
    jurisdiction: 'US-CA',
    title:        'Replacing the mixer drive belt',
    body: {
      scope: 'x', steps: [], ppe: [], emergencyArrangements: 'y',
    },
    citations: [],
  }

  it('accepts a well-formed payload', () => {
    const result = validateDraftPayload(valid)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.envelope.kind).toBe('method_statement')
  })

  it('refuses a payload from an older format with a readable reason', () => {
    // Drafts outlive the schema; a reviewer opening a stale one must get an
    // explanation, not a crash or a half-rendered document.
    const result = validateDraftPayload({ ...valid, version: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('format v0')
  })

  it('refuses a payload missing its jurisdiction', () => {
    const result = validateDraftPayload({ ...valid, jurisdiction: '  ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('jurisdiction')
  })

  it('names the sections a draft is missing', () => {
    const result = validateDraftPayload({ ...valid, body: { scope: 'x' } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('steps')
      expect(result.reason).toContain('emergencyArrangements')
    }
  })

  it('refuses non-object and null payloads', () => {
    expect(validateDraftPayload(null).ok).toBe(false)
    expect(validateDraftPayload('{}').ok).toBe(false)
  })

  it('refuses a payload with no citation list at all', () => {
    const { citations, ...noCitations } = valid
    void citations
    expect(validateDraftPayload(noCitations).ok).toBe(false)
  })
})

describe('draftProvenanceNotice', () => {
  const base = { aiOrigin: true, aiEdited: false, model: 'claude-sonnet-5', fabricatedCitationCount: 0 }

  it('says who wrote it and where responsibility sits', () => {
    expect(draftProvenanceNotice(base)).toContain("reviewer's responsibility")
  })

  it('tells the reviewer when citations were removed', () => {
    // A reviewer who knows the model invented references reads the rest
    // differently — that recalibration beats a clean-looking document.
    const notice = draftProvenanceNotice({ ...base, fabricatedCitationCount: 2 })
    expect(notice).toContain('2 unverifiable citations were removed')
  })

  it('uses the singular for one removed citation', () => {
    expect(draftProvenanceNotice({ ...base, fabricatedCitationCount: 1 }))
      .toContain('1 unverifiable citation was removed')
  })

  it('does not claim AI authorship for human-written content', () => {
    expect(draftProvenanceNotice({ ...base, aiOrigin: false })).toBe('Written by a person.')
  })
})
