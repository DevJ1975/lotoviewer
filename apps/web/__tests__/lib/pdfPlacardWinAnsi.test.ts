/**
 * Regression test for the placard generator's WinAnsi handling.
 *
 * Background: the StandardFonts pdf-lib uses (Helvetica) only support
 * WinAnsi (CP1252). Anything outside that — Unicode subscripts (O₂),
 * mathematical symbols (≥), CJK, emoji — throws on widthOfTextAtSize
 * AND drawText. Field workers paste this stuff into equipment notes
 * routinely (AI-generated hazards include O₂; iOS autocomplete inserts
 * em-dashes that ARE in WinAnsi but adjacent typography that isn't).
 *
 * Before this fix, wrapText() and a few direct draw sites measured /
 * emitted raw text without sanitising — so a single bad character in
 * equipment.notes silently broke the entire placard PDF generation.
 *
 * This test reproduces the original crash (subscripts in notes) +
 * pins related Unicode classes that should now also be safe.
 */
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { generatePlacardPdf } from '@/lib/pdfPlacard'
import type { Equipment, LotoEnergyStep } from '@/lib/types'

function makeEquipment(partial: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id:       'EQ-WINANSI',
    description:        'Test equipment',
    department:         'Packaging',
    prefix:             null,
    photo_status:       'missing',
    has_equip_photo:    false,
    has_iso_photo:      false,
    equip_photo_url:    null,
    iso_photo_url:      null,
    placard_url:        null,
    signed_placard_url: null,
    notes:              'Stay clear',
    notes_es:           null,
    internal_notes:     null,
    spanish_reviewed:   false,
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

function makeStep(partial: Partial<LotoEnergyStep> = {}): LotoEnergyStep {
  return {
    id:                          's-1',
    equipment_id:                'EQ-WINANSI',
    energy_type:                 'E',
    step_number:                 1,
    tag_description:             'Open the breaker',
    isolation_procedure:         'Apply lock to breaker',
    method_of_verification:      'Test for voltage',
    tag_description_es:          null,
    isolation_procedure_es:      null,
    method_of_verification_es:   null,
    ...partial,
  }
}

describe('placard PDF — WinAnsi safety', () => {
  // ── The original crash ─────────────────────────────────────────────────

  it('does NOT crash on subscripts in equipment.notes (the original bug)', async () => {
    // Before the wrapText sanitiser fix this threw:
    //   "WinAnsi cannot encode "₂" (0x2082)"
    // from widthOfTextAtSize during wrapping. The placard never made
    // it to drawText.
    const eq = makeEquipment({
      notes: 'Verify O₂ ≥ 19.5%, H₂S ≤ 10 ppm, CO₂ purge complete',
    })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(1000)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)   // EN + ES
  })

  // ── Other Unicode classes ──────────────────────────────────────────────

  it('does NOT crash on emoji in notes (iOS keyboard autocompletes)', async () => {
    const eq = makeEquipment({
      notes: '⚠ Hazardous machine — verify lockout 🔒',
    })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('does NOT crash on CJK in notes (multilingual sites)', async () => {
    const eq = makeEquipment({
      notes: 'Emergency stop · 紧急停止 · 緊急停止',
    })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('does NOT crash on subscripts in equipment.department', async () => {
    // Department gets drawn directly via widthOfTextAtSize — the bug
    // was at the call site, not just in wrapText.
    const eq = makeEquipment({ department: 'CO₂ Plant' })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('does NOT crash on subscripts in equipment.description', async () => {
    const eq = makeEquipment({ description: 'O₂ regulator manifold #4' })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('does NOT crash on subscripts in step.energy_type', async () => {
    // The energy-type code is normally a single ASCII letter, but
    // the schema allows any string. A pasted subscript would crash
    // the per-step row draw.
    const step = makeStep({ energy_type: 'CO₂' })
    const bytes = await generatePlacardPdf({ equipment: makeEquipment(), steps: [step] })
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('does NOT crash on Unicode in step descriptions / procedures / verification', async () => {
    // All three step-row fields go through drawWrapped → wrapText →
    // sanitised. Combined into one test so the row exercises every
    // column.
    const step = makeStep({
      tag_description:        'Open valve V₁₂ — verify pressure ≤ 10 psi',
      isolation_procedure:    'Lock with red padlock; tag with worker ID and date — verify O₂ vent line',
      method_of_verification: 'Confirm pressure gauge reads 0 ± 0.5 psi after 5-min hold',
    })
    const bytes = await generatePlacardPdf({
      equipment: makeEquipment(),
      steps:     [step],
    })
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('survives the worst-case payload — subscripts + emoji + smart quotes + CJK in every field', async () => {
    // Belt-and-suspenders: every user-content field gets gnarly input
    // simultaneously. If this works, the most realistic combinations
    // (one or two of these per equipment row) definitely work too.
    const eq = makeEquipment({
      department:  '🏭 CO₂ Plant — 工厂',
      description: 'O₂ regulator "HP-4" with CJK label 高压',
      notes:       'Emergency stop ⚠ — verify O₂ ≥ 19.5%, H₂S ≤ 10 ppm 🔒 紧急',
    })
    const step = makeStep({
      energy_type:            'E₁',
      tag_description:        'Open breaker — "OFF" position 关',
      isolation_procedure:    'Apply lock × tag · verify ≤ 0.5V across L1-L2-L3 ⚡',
      method_of_verification: 'Multimeter reads 0V ± 0.1V — confirm with peer 验证',
    })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [step] })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    // The placard should still be a substantive document, not just an
    // empty header page.
    expect(bytes.length).toBeGreaterThan(2000)
  })
})
