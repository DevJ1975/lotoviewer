import { describe, it, expect } from 'vitest'
import {
  defaultAcceptedIndices,
  environmentalDocumentPath,
  ENVIRONMENTAL_DOCS_BUCKET,
  isIsoDate,
  parseProposal,
  planObligations,
  reviewAcceptedFields,
  MAX_ACCEPTED_FIELDS,
  MAX_FIELD_VALUE_LENGTH,
  type DocumentProposal,
  type ProposedField,
  type ReviewedField,
} from '../documentExtraction'

const field = (over: Partial<ProposedField> = {}): ProposedField => ({
  key: 'permit_number', label: 'Permit number', value: 'F98765',
  confidence: 'medium', evidence: 'Permit No.: F98765', repaired: false, ...over,
})

const proposal = (fields: ProposedField[], over: Partial<DocumentProposal> = {}): DocumentProposal => ({
  docType: 'air_permit', docTypeConfidence: 'high', overallConfidence: 'medium',
  viaOcr: false, notes: '', fields, ...over,
})

describe('isIsoDate', () => {
  it('accepts real dates, including a leap day', () => {
    expect(isIsoDate('2027-04-30')).toBe(true)
    expect(isIsoDate('2028-02-29')).toBe(true)
  })

  it('rejects impossible and badly shaped dates', () => {
    for (const bad of ['2027-02-30', '2027-13-01', '2027-4-30', '04/30/2027', '2027-04-30T00:00', '', '2027-00-10', '2027-02-29']) {
      expect(isIsoDate(bad), bad).toBe(false)
    }
  })
})

describe('parseProposal', () => {
  const row = (extraction: unknown) => ({
    doc_type: 'air_permit', doc_type_confidence: 'high', overall_confidence: 'medium', via_ocr: false, extraction,
  })

  it('reads what the service stores', () => {
    const p = parseProposal(row({ notes: 'Check it.', fields: [field()] }))
    expect(p).toEqual(proposal([field()], { notes: 'Check it.' }))
  })

  it('returns null when there is no usable extraction', () => {
    for (const bad of [null, undefined, 'x', 7, [], [{}]]) expect(parseProposal(row(bad))).toBeNull()
  })

  it('drops malformed fields instead of rendering them', () => {
    const p = parseProposal(row({ fields: [
      field(), null, 'x', { key: 'a' }, { key: 'a', value: 1, confidence: 'high' },
      { key: 'a', value: 'v', confidence: 'certain' },
    ] }))
    expect(p?.fields).toHaveLength(1)
  })

  it('falls back to the cautious value for an unknown type or confidence', () => {
    const p = parseProposal({ doc_type: 'invoice', doc_type_confidence: '??', overall_confidence: null, via_ocr: 'yes', extraction: { fields: [] } })
    expect(p).toMatchObject({ docType: 'other', docTypeConfidence: 'low', overallConfidence: 'low', viaOcr: false })
  })

  it('fills in a missing label and evidence rather than failing', () => {
    const p = parseProposal(row({ fields: [{ key: 'permit_number', value: 'F1', confidence: 'low' }] }))
    expect(p?.fields[0]).toMatchObject({ label: 'permit_number', evidence: '', repaired: false })
  })
})

describe('defaultAcceptedIndices', () => {
  const fields = [
    field({ confidence: 'high' }),
    field({ confidence: 'medium' }),
    field({ confidence: 'low' }),
    field({ confidence: 'high', repaired: true }),
  ]

  it('pre-ticks only confident, unrepaired fields', () => {
    expect(defaultAcceptedIndices(proposal(fields))).toEqual([0, 1])
  })

  it('pre-ticks nothing from a scan, however confident each field looks', () => {
    expect(defaultAcceptedIndices(proposal(fields, { viaOcr: true }))).toEqual([])
  })
})

describe('reviewAcceptedFields', () => {
  const expiry = field({ key: 'expiration_date', label: 'Expiration date', value: '2027-04-30' })
  const p = proposal([field(), expiry])

  it('confirms a field as proposed', () => {
    expect(reviewAcceptedFields(p, [{ index: 0, value: 'F98765' }])).toEqual({
      ok: true, fields: [{ key: 'permit_number', label: 'Permit number', value: 'F98765', edited: false }],
    })
  })

  it('marks a corrected value as edited and trims it', () => {
    const r = reviewAcceptedFields(p, [{ index: 0, value: '  F98766 ' }])
    expect(r).toMatchObject({ ok: true, fields: [{ value: 'F98766', edited: true }] })
  })

  it('refuses a field the service did not find', () => {
    for (const index of [2, -1, 1.5, '0', null, undefined]) {
      expect(reviewAcceptedFields(p, [{ index, value: 'x' }]), String(index)).toMatchObject({ ok: false })
    }
  })

  it('refuses the same field twice', () => {
    expect(reviewAcceptedFields(p, [{ index: 0, value: 'a' }, { index: 0, value: 'b' }])).toMatchObject({ ok: false })
  })

  it('needs at least one field, and not more than the limit', () => {
    expect(reviewAcceptedFields(p, [])).toMatchObject({ ok: false })
    expect(reviewAcceptedFields(p, 'nope')).toMatchObject({ ok: false })
    const many = Array.from({ length: MAX_ACCEPTED_FIELDS + 1 }, () => ({ index: 0, value: 'x' }))
    expect(reviewAcceptedFields(p, many)).toMatchObject({ ok: false })
  })

  it('refuses a blank or oversized value', () => {
    expect(reviewAcceptedFields(p, [{ index: 0, value: '   ' }])).toMatchObject({ ok: false })
    expect(reviewAcceptedFields(p, [{ index: 0, value: 7 }])).toMatchObject({ ok: false })
    expect(reviewAcceptedFields(p, [{ index: 0, value: 'x'.repeat(MAX_FIELD_VALUE_LENGTH + 1) }])).toMatchObject({ ok: false })
  })

  it('requires a real date for date fields, even a corrected one', () => {
    expect(reviewAcceptedFields(p, [{ index: 1, value: '2027-04-30' }])).toMatchObject({ ok: true })
    expect(reviewAcceptedFields(p, [{ index: 1, value: '2027-02-30' }])).toMatchObject({ ok: false })
    expect(reviewAcceptedFields(p, [{ index: 1, value: 'next spring' }])).toMatchObject({ ok: false })
  })

  it('does not trust a client-supplied key or label', () => {
    const r = reviewAcceptedFields(p, [{ index: 0, value: 'x', key: 'expiration_date', label: 'Forged' }])
    expect(r).toMatchObject({ ok: true, fields: [{ key: 'permit_number', label: 'Permit number' }] })
  })
})

describe('planObligations', () => {
  const source = { documentId: 'doc-1', docType: 'air_permit' as const, fileName: 'permit.pdf' }
  const reviewed = (key: string, value: string, label = key): ReviewedField => ({ key, label, value, edited: false })

  it('turns a confirmed expiration date into a one-time calendar entry naming the permit', () => {
    const [o] = planObligations([reviewed('permit_number', 'F98765'), reviewed('expiration_date', '2027-04-30')], source)
    expect(o).toMatchObject({
      title: 'Air permit F98765 expires', next_due_at: '2027-04-30',
      cadence: 'once', category: 'environmental', evidence_id: 'document_extractions:doc-1',
    })
    expect(o.description).toContain('permit.pdf')
  })

  it("uses the document's own renewal date and never invents one", () => {
    const out = planObligations([reviewed('expiration_date', '2027-04-30'), reviewed('renewal_due_date', '2027-01-30')], source)
    expect(out.map(o => [o.title, o.next_due_at])).toEqual([
      ['Air permit expires', '2027-04-30'],
      ['Submit renewal: Air permit', '2027-01-30'],
    ])
  })

  it('creates nothing for fields that are not deadlines', () => {
    expect(planObligations([reviewed('permit_number', 'F98765'), reviewed('issue_date', '2024-04-01'), reviewed('effective_date', '2024-04-01')], source)).toEqual([])
  })

  it('skips a deadline that is not a real date', () => {
    expect(planObligations([reviewed('expiration_date', '2027-02-30')], source)).toEqual([])
  })

  it('lists a repeated date once', () => {
    expect(planObligations([reviewed('expiration_date', '2027-04-30'), reviewed('expiration_date', '2027-04-30')], source)).toHaveLength(1)
  })

  it('keeps an over-long title within the limit', () => {
    const [o] = planObligations([reviewed('permit_number', 'X'.repeat(500)), reviewed('expiration_date', '2027-04-30')], source)
    expect(o.title.length).toBeLessThanOrEqual(200)
  })

  it('prefers the more specific identifier when several are confirmed', () => {
    const [o] = planObligations(
      [reviewed('tpdes_stormwater_authorization', 'TXR05AB12'), reviewed('expiration_date', '2031-03-04')],
      { ...source, docType: 'stormwater_permit' },
    )
    expect(o.title).toBe('Stormwater permit TXR05AB12 expires')
  })
})

describe('storage location', () => {
  it('keys a document under its tenant, which the table CHECK requires', () => {
    expect(ENVIRONMENTAL_DOCS_BUCKET).toBe('environmental-docs')
    expect(environmentalDocumentPath('tenant-1', 'doc-1')).toBe('tenant-1/doc-1.pdf')
  })
})
