import { describe, it, expect } from 'vitest'
import { generateSdsFacsimilePdf } from '@/lib/pdfSdsFacsimile'
import { type SdsFacsimileModel } from '@soteria/core/sdsFacsimile'

// Smoke test for the SDS facsimile PDF generator. Like pdfOshaSmoke, this
// doesn't validate visual fidelity — it confirms the renderer doesn't throw,
// returns a non-empty Uint8Array starting with the PDF magic number, and
// survives the things that crash pdf-lib in practice: Unicode subscripts in
// chemical text (CO₂, H₂S), empty placeholder sections, and the QR path.

const MODEL: SdsFacsimileModel = {
  productName: 'Acetone (CO₂ compatibility test)',
  signalWord:  'danger',
  pictograms:  ['GHS02', 'GHS07'],
  sections: [
    {
      number: 1, title: 'Identification',
      fields: [
        { label: 'Product name', value: 'Acetone' },
        { label: 'Manufacturer', value: 'Fisher Scientific' },
      ],
    },
    {
      number: 2, title: 'Hazard(s) Identification',
      fields: [
        { label: 'Signal word', value: 'DANGER' },
        { label: 'H225', value: 'Highly flammable liquid and vapour.' },
        // Exercise the WinAnsi sanitiser with a subscript-laden value.
        { label: 'Note', value: 'Reacts to release H₂S and CO₂.' },
      ],
    },
    // An empty section must render the not-extracted note, not crash.
    { number: 10, title: 'Stability and Reactivity', fields: [] },
  ],
  provenance: {
    sourceUrl:       'https://fishersci.com/acetone-sds.pdf',
    revisionDate:    '2025-03-12',
    parsedDate:      '2026-06-01',
    parseModel:      'claude-sonnet-4-6',
    parseConfidence: 'high',
  },
}

function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
}

describe('generateSdsFacsimilePdf', () => {
  it('produces a non-empty PDF', async () => {
    const bytes = await generateSdsFacsimilePdf({ model: MODEL })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
    expect(isPdf(bytes)).toBe(true)
  })

  it('embeds a QR when a view URL is supplied', async () => {
    const bytes = await generateSdsFacsimilePdf({ model: MODEL, viewUrl: 'https://app.example.com/chemicals/abc' })
    expect(isPdf(bytes)).toBe(true)
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('renders a model whose sections are all empty', async () => {
    const empty: SdsFacsimileModel = {
      ...MODEL,
      signalWord: null,
      pictograms: [],
      sections: [{ number: 1, title: 'Identification', fields: [] }],
      provenance: { sourceUrl: null, revisionDate: null, parsedDate: null, parseModel: null, parseConfidence: null },
    }
    const bytes = await generateSdsFacsimilePdf({ model: empty })
    expect(isPdf(bytes)).toBe(true)
  })
})
