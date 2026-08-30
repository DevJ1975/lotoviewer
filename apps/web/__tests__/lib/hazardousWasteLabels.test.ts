import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  renderHazardousWasteLabel,
  HW_LABEL_SIZES,
  type HazardousWasteLabelTemplate,
  type HwContainerLabelInput,
  type HwAreaPlacardInput,
} from '@/lib/hazardousWasteLabels'

const containerInput: HwContainerLabelInput = {
  stream_id:               '00000000-0000-0000-0000-000000000001',
  stream_name:             'Spent xylene from parts washer',
  accumulation_start_date: '2026-06-01',
  waste_codes:             ['D001', 'F003', 'F005'],
  hazards:                 ['Flammable liquid', 'Acutely toxic vapor'],
  ghs_signal_word:         'danger',
  ghs_pictograms:          ['GHS02', 'GHS07'],
  nfpa_health:             2,
  nfpa_flammability:       3,
  nfpa_instability:        0,
  nfpa_special:            null,
  dot: {
    un_number:            'UN1307',
    hazard_class:         '3',
    packing_group:        'II',
    proper_shipping_name: 'Xylenes',
  },
  generator_name:          'Fixture Manufacturing Co.',
  generator_category:      'lqg',
  qr_url:                  'https://example.test/hazardous-waste/streams/00000000-0000-0000-0000-000000000001',
  tenant_name:             'Fixture Tenant',
}

const placardInput: HwAreaPlacardInput = {
  area_id:                 '00000000-0000-0000-0000-000000000002',
  area_name:               'Central Accumulation Area – Dock 4',
  area_type_label:         'Central accumulation',
  inspection_cadence_days: 7,
  ghs_pictograms:          ['GHS02', 'GHS05', 'GHS06'],
  dot_hazard_classes:      ['3', '8', '6.1'],
  stream_names:            ['Spent xylene', 'Waste sulfuric acid', 'Lab pack – oxidizers'],
  emergency_contacts:      ['Spill response: 555-0100', 'EHS manager: 555-0142'],
  qr_url:                  'https://example.test/hazardous-waste/areas/00000000-0000-0000-0000-000000000002',
  tenant_name:             'Fixture Tenant',
}

function inputFor(template: HazardousWasteLabelTemplate) {
  return template === 'hw_container' ? containerInput : placardInput
}

const TEMPLATE_SIZE: Array<[HazardousWasteLabelTemplate, string]> = [
  ['hw_container',            '4x6'],
  ['hw_container',            '8.5x11'],
  ['hw_accumulation_placard', '8.5x11'],
  ['hw_accumulation_placard', '11x17'],
]

describe('renderHazardousWasteLabel', () => {
  it.each(TEMPLATE_SIZE)('produces a valid PDF for %s @ %s', async (template, sizeKey) => {
    const result = await renderHazardousWasteLabel({
      template,
      sizeKey,
      input: inputFor(template),
    })
    expect(result.bytes.byteLength).toBeGreaterThan(0)
    expect(result.byteSize).toBe(result.bytes.byteLength)
    expect(result.filename.endsWith('.pdf')).toBe(true)
    expect(result.filename).toContain(template)

    // Confirm pdf-lib can re-parse what we emitted (catches malformed PDFs).
    const reparsed = await PDFDocument.load(result.bytes)
    expect(reparsed.getPageCount()).toBe(1)

    const expected = HW_LABEL_SIZES[template].find(s => s.key === sizeKey)!
    const page = reparsed.getPage(0)
    expect(page.getWidth()).toBeCloseTo(expected.width, 1)
    expect(page.getHeight()).toBeCloseTo(expected.height, 1)
  })

  it('rejects an unknown template', async () => {
    await expect(renderHazardousWasteLabel({
      template: 'bogus' as HazardousWasteLabelTemplate,
      sizeKey:  '4x6',
      input:    containerInput,
    })).rejects.toThrow(/Unknown template/)
  })

  it('rejects an unknown size for a known template', async () => {
    await expect(renderHazardousWasteLabel({
      template: 'hw_container',
      sizeKey:  '99x99',
      input:    containerInput,
    })).rejects.toThrow(/Unknown size/)
  })

  it('drops invalid GHS / DOT codes silently rather than crashing', async () => {
    const result = await renderHazardousWasteLabel({
      template: 'hw_container',
      sizeKey:  '4x6',
      input: {
        ...containerInput,
        ghs_pictograms: ['GHS02', 'GHS99' as never, 'GHS07'],
        dot: { ...containerInput.dot, hazard_class: 'not-a-class' },
      },
    })
    expect(result.bytes.byteLength).toBeGreaterThan(0)
  })

  it('handles WinAnsi-unfriendly characters in the stream name', async () => {
    const result = await renderHazardousWasteLabel({
      template: 'hw_container',
      sizeKey:  '8.5x11',
      input: {
        ...containerInput,
        stream_name: 'Spent H₂SO₄ — strong acid (≥ 95%)',
      },
    })
    expect(result.bytes.byteLength).toBeGreaterThan(0)
  })

  it('renders an area placard with no aggregated hazards', async () => {
    const result = await renderHazardousWasteLabel({
      template: 'hw_accumulation_placard',
      sizeKey:  '8.5x11',
      input: {
        ...placardInput,
        ghs_pictograms:     [],
        dot_hazard_classes: [],
        stream_names:       [],
        emergency_contacts: [],
      },
    })
    expect(result.bytes.byteLength).toBeGreaterThan(0)
  })
})

describe('HW_LABEL_SIZES catalog', () => {
  it('exposes each template with at least one size', () => {
    for (const t of Object.keys(HW_LABEL_SIZES) as HazardousWasteLabelTemplate[]) {
      expect(HW_LABEL_SIZES[t].length).toBeGreaterThan(0)
      for (const s of HW_LABEL_SIZES[t]) {
        expect(s.width).toBeGreaterThan(0)
        expect(s.height).toBeGreaterThan(0)
        expect(s.key).toBeTruthy()
      }
    }
  })
})
