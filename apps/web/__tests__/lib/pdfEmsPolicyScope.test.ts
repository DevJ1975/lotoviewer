import { describe, it, expect } from 'vitest'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { generatePolicyScopeStatement } from '@/lib/pdfEmsPolicyScope'
import type { PolicyRow, ScopeRow } from '@/lib/environmental/client'

// The policy-and-scope statement leaves the organization, so the tests read
// back what is printed on it: what clauses 4.3 and 5.2 make public, and
// nothing internal.

/** Every string drawn on the document, in drawing order. */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const lines: string[] = []
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of('Contents'))
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents]
    for (const ref of refs) {
      const stream = doc.context.lookup(ref)
      if (!(stream instanceof PDFRawStream)) continue
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
      for (const [, hex] of operators.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) lines.push(Buffer.from(hex, 'hex').toString('latin1'))
    }
  }
  return lines.join('\n')
}

const scope: ScopeRow = {
  id: 's1', version: 2, legal_entity: 'Northfield Forge & Finish LLC',
  physical_boundary: 'The Northfield Plant inside the fence line', activities: 'Forging, machining and finishing',
  products_services: 'Forged steel components',
  control_and_influence: 'We control every activity on site; we influence our mills and carriers.',
  exclusions: null, effective_from: '2026-03-01', next_review_due: '2027-03-01', created_at: '2026-03-01T00:00:00Z',
}

const policy: PolicyRow = {
  id: 'p1', version: 3, body: 'We protect the environment and prevent pollution.',
  commitments: { 'ems.protect_environment': true, 'ems.fulfil_obligations': true, 'ems.continual_improvement': true },
  signatory_name: 'Demo Plant Manager', signatory_title: 'Plant Manager', signed_at: '2026-03-10',
  next_review_due: '2027-03-10', created_at: '2026-03-10T00:00:00Z',
}

const commitments = [
  { key: 'ems.protect_environment', label: 'Protect the environment, including preventing pollution' },
  { key: 'ems.fulfil_obligations', label: 'Fulfil our compliance obligations' },
  { key: 'ems.continual_improvement', label: 'Continually improve the EMS' },
]

const render = (over: { scope?: Partial<ScopeRow>; policy?: Partial<PolicyRow> } = {}) => generatePolicyScopeStatement({
  scope: { ...scope, ...over.scope }, policy: { ...policy, ...over.policy }, commitments, issuedOn: '2026-10-02',
})

describe('generatePolicyScopeStatement', () => {
  it('prints the policy, its commitments and signature, and every part of the scope', async () => {
    const text = await drawnText(await render())
    for (const expected of [
      'ENVIRONMENTAL POLICY AND EMS SCOPE', 'Northfield Forge & Finish LLC', 'ENVIRONMENTAL POLICY · VERSION 3',
      'We protect the environment and prevent pollution.', 'Fulfil our compliance obligations',
      'Signed by Demo Plant Manager, Plant Manager, 2026-03-10',
      'Physical boundary', 'The Northfield Plant inside the fence line', 'Control and influence',
      'We control every activity on site; we influence our mills and carriers.',
    ]) expect(text).toContain(expected)
  })

  it('says plainly when nothing is excluded, or when a version predates control and influence', async () => {
    const text = await drawnText(await render({ scope: { control_and_influence: null } }))
    expect(text).toContain('None.')
    expect(text).toContain('Not stated in this version.')
    expect(await drawnText(await render({ scope: { exclusions: 'The leased warehouse, run by its landlord.' } })))
      .toContain('The leased warehouse, run by its landlord.')
  })

  it('prints only the commitments the policy states', async () => {
    const text = await drawnText(await render({ policy: { commitments: { 'ems.protect_environment': true } } }))
    expect(text).not.toContain('Fulfil our compliance obligations')
  })

  it('keeps internal review dates off a document meant for outsiders', async () => {
    const text = await drawnText(await render())
    expect(text).not.toContain('2027-03-01')
    expect(text).not.toContain('2027-03-10')
  })

  it('runs a long policy onto further pages rather than off the first', async () => {
    const body = Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1} of our environmental commitments.`).join('\n')
    const doc = await PDFDocument.load(await render({ policy: { body } }))
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })

  it('survives characters the PDF fonts cannot encode', async () => {
    const bytes = await render({ scope: { legal_entity: 'Acme — “Field” Co. O₂ 😀' } })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1)
  })
})
