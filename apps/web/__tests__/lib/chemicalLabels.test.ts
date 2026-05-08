import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  renderChemicalLabel,
  LABEL_SIZES,
  type LabelInput,
  type LabelTemplate,
} from '@/lib/chemicalLabels'

const baseInput: LabelInput = {
  product_id:        '00000000-0000-0000-0000-000000000001',
  product_name:      'Acetone',
  manufacturer:      'Acme Solvents',
  product_code:      'ACE-100',
  ghs_signal_word:   'danger',
  ghs_pictograms:    ['GHS02', 'GHS07'],
  hazard_statements: [
    { code: 'H225', text: 'Highly flammable liquid and vapour.' },
    { code: 'H319', text: 'Causes serious eye irritation.' },
  ],
  ppe_required:      ['Nitrile gloves', 'Safety glasses'],
  nfpa_health:       1,
  nfpa_flammability: 3,
  nfpa_instability:  0,
  nfpa_special:      null,
  cas_numbers:       ['67-64-1'],
  storage_class:     'Flammable cabinet',
  qr_url:            'https://example.test/chemicals/00000000-0000-0000-0000-000000000001',
  barcode:           'CHEM-0001',
  tenant_name:       'Fixture Tenant',
}

const TEMPLATE_SIZE: Array<[LabelTemplate, string]> = [
  ['secondary_container', '4x6'],
  ['secondary_container', '2x4'],
  ['secondary_container', '8.5x11'],
  ['placard',             '8.5x11'],
  ['placard',             '11x17'],
  ['inventory_tag',       '2x1'],
  ['inventory_tag',       '4x2'],
]

describe('renderChemicalLabel', () => {
  it.each(TEMPLATE_SIZE)('produces a valid PDF for %s @ %s', async (template, sizeKey) => {
    const result = await renderChemicalLabel({
      template,
      sizeKey,
      input: baseInput,
    })
    expect(result.bytes.byteLength).toBeGreaterThan(0)
    expect(result.byteSize).toBe(result.bytes.byteLength)
    expect(result.filename.endsWith('.pdf')).toBe(true)
    expect(result.filename).toContain(template)

    // Confirm pdf-lib can re-parse what we emitted (catches malformed PDFs).
    const reparsed = await PDFDocument.load(result.bytes)
    expect(reparsed.getPageCount()).toBe(1)

    const expected = LABEL_SIZES[template].find(s => s.key === sizeKey)!
    const page = reparsed.getPage(0)
    expect(page.getWidth()).toBeCloseTo(expected.width, 1)
    expect(page.getHeight()).toBeCloseTo(expected.height, 1)
  })

  it('rejects an unknown template', async () => {
    await expect(renderChemicalLabel({
      template: 'bogus' as LabelTemplate,
      sizeKey:  '4x6',
      input:    baseInput,
    })).rejects.toThrow(/Unknown template/)
  })

  it('rejects an unknown size for a known template', async () => {
    await expect(renderChemicalLabel({
      template: 'secondary_container',
      sizeKey:  '99x99',
      input:    baseInput,
    })).rejects.toThrow(/Unknown size/)
  })

  it('drops invalid GHS codes silently rather than crashing', async () => {
    // The renderer is defensive — the API filters too, but a stale
    // hazard_statements entry shouldn't take down the print job.
    const result = await renderChemicalLabel({
      template: 'secondary_container',
      sizeKey:  '4x6',
      input:    {
        ...baseInput,
        ghs_pictograms: ['GHS02', 'GHS99' as never, 'GHS07'],
      },
    })
    expect(result.bytes.byteLength).toBeGreaterThan(0)
  })

  it('handles WinAnsi-unfriendly characters in product name', async () => {
    // pdf-lib's StandardFonts crash on Unicode outside CP1252 — the
    // sanitiser is supposed to substitute them. A regression here once
    // crashed the placard generator.
    const result = await renderChemicalLabel({
      template: 'placard',
      sizeKey:  '8.5x11',
      input: {
        ...baseInput,
        product_name: 'H₂SO₄ — strong sulphuric acid (≥ 95%)',
      },
    })
    expect(result.bytes.byteLength).toBeGreaterThan(0)
  })

  it('renders without QR / barcode if both are absent', async () => {
    const result = await renderChemicalLabel({
      template: 'inventory_tag',
      sizeKey:  '2x1',
      input: {
        ...baseInput,
        barcode: null,
        qr_url:  '',  // embedQrCode handles empty URL gracefully
      },
    })
    expect(result.bytes.byteLength).toBeGreaterThan(0)
  })
})

describe('LABEL_SIZES catalog', () => {
  it('exposes each template with at least one size', () => {
    for (const t of Object.keys(LABEL_SIZES) as LabelTemplate[]) {
      expect(LABEL_SIZES[t].length).toBeGreaterThan(0)
      for (const s of LABEL_SIZES[t]) {
        expect(s.width).toBeGreaterThan(0)
        expect(s.height).toBeGreaterThan(0)
        expect(s.key).toBeTruthy()
      }
    }
  })
})
