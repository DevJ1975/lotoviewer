import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { generatePlacardPdf, generateBilingualPlacardPdf } from '@/lib/pdfPlacard'
import type { Equipment } from '@/lib/types'

// generateBilingualPlacardPdf composes the EN and ES placard pages into
// a single side-by-side letter-landscape sheet. We don't snapshot pixel
// output (PDF date stamps are non-deterministic), but we can assert
// page count and that the file re-parses — same level of confidence as
// the per-permit smoke tests.

function makeEquipment(partial: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id:       'EQ-BILING-TEST',
    description:        'Mixer pump',
    department:         'Packaging',
    prefix:             null,
    photo_status:       'missing',
    has_equip_photo:    false,
    has_iso_photo:      false,
    equip_photo_url:    null,
    iso_photo_url:      null,
    placard_url:        null,
    signed_placard_url: null,
    notes:              'Stay clear of the inlet during purge.',
    notes_es:           'No se acerque a la entrada durante la purga.',
    internal_notes:     null,
    spanish_reviewed:   true,
    verified:           false,
    verified_date:      null,
    verified_by:        null,
    needs_equip_photo:  true,
    needs_iso_photo:    true,
    needs_verification: false,
    decommissioned:     false,
    annotations:        [],
    iso_annotations:    [],
    created_at:         '2026-01-01T00:00:00Z',
    updated_at:         '2026-04-01T00:00:00Z',
    ...partial,
  }
}

describe('generateBilingualPlacardPdf', () => {
  it('returns a non-empty Uint8Array for a typical equipment row', async () => {
    const bytes = await generateBilingualPlacardPdf({ equipment: makeEquipment(), steps: [] })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('produces a parseable PDF', async () => {
    const bytes = await generateBilingualPlacardPdf({ equipment: makeEquipment(), steps: [] })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('produces a SINGLE page (vs the two-page sequential output)', async () => {
    // The whole point of the bilingual variant is one printable sheet
    // instead of two — pin that contract so a future "while we're at it"
    // refactor doesn't accidentally split it back into pages.
    const bytes = await generateBilingualPlacardPdf({ equipment: makeEquipment(), steps: [] })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)

    // And confirm the per-language sequential output still emits two
    // pages so we don't accidentally regress the existing flow.
    const sequential = await generatePlacardPdf({ equipment: makeEquipment(), steps: [] })
    const sequentialDoc = await PDFDocument.load(sequential)
    expect(sequentialDoc.getPageCount()).toBe(2)
  })

  it('uses letter-landscape page geometry (same as the per-language placard)', async () => {
    const bytes = await generateBilingualPlacardPdf({ equipment: makeEquipment(), steps: [] })
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPage(0)
    // 792 × 612 = letter landscape.
    expect(Math.round(page.getWidth())).toBe(792)
    expect(Math.round(page.getHeight())).toBe(612)
  })

  it('survives equipment with no Spanish notes (renders the en/es watermark on the ES half)', async () => {
    // notes_es null + spanish_reviewed false is the pre-translation
    // state. The placard page draws "BORRADOR — NO REVISADO" diagonally
    // across; the bilingual generator should pass that through without
    // crashing.
    const bytes = await generateBilingualPlacardPdf({
      equipment: makeEquipment({ notes_es: null, spanish_reviewed: false }),
      steps: [],
    })
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('handles an equipment row with notes containing WinAnsi-safe typographic chars', async () => {
    // Smart quotes + em-dashes are IN WinAnsi (0x80-0x9F range) and
    // should pass through. Subscripts / ≥ are NOT in WinAnsi and
    // currently crash the placard wrapText path — that's a pre-
    // existing bug separate from this PR; tracking as a follow-up.
    const bytes = await generateBilingualPlacardPdf({
      equipment: makeEquipment({
        notes: 'Confirm "purge complete" before unlock — supervisor sign-off required.',
      }),
      steps: [],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })
})
