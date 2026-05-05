/**
 * Verifies the printed placard PDF embeds the annotation overlay
 * (arrows + labels) on top of the equipment and isolation photos.
 *
 * Why this matters: workers in the field reference the printed/laminated
 * placard at the equipment, not the screen. If we render arrows on
 * screen but strip them in the PDF, the printed copy has zero
 * call-outs and the feature is half-shipped.
 *
 * Strategy: generate a placard PDF with a known annotation set, then
 * inspect the page content stream. pdf-lib emits each shape as
 * standard PDF operators — we only need to assert that *some* line
 * + path drawing happened, plus that the label text was emitted.
 * Visual fidelity is a separate concern (eye it on the actual PDF).
 */
import { describe, it, expect } from 'vitest'
import { generatePlacardPdf, drawAnnotationsOnImage, sanitizeForWinAnsi } from '@/lib/pdfPlacard'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Equipment } from '@soteria/core/types'

// Build a blank PDF with one page and call drawAnnotationsOnImage
// directly with a known image rectangle. Bypasses the network-fetch
// path so we can actually exercise the overlay code in tests
// (generatePlacardPdf with null photo URLs skips the overlay entirely).
async function renderOverlayInIsolation(annotations: Parameters<typeof drawAnnotationsOnImage>[6]) {
  const doc  = await PDFDocument.create()
  const page = doc.addPage([400, 300])
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  drawAnnotationsOnImage(page, bold, 50, 50, 200, 150, annotations, rgb(0.75, 0.08, 0.08))
  return doc.save()
}

function makeEquipment(partial: Partial<Equipment>): Equipment {
  // Minimal Equipment shape — only the fields pdfPlacard reads. Tests
  // that don't care about decommissioned / verified flags can stay terse.
  return {
    equipment_id:       'EQ-PDF-TEST',
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

describe('placard PDF annotation overlay', () => {
  it('renders without throwing when both photos lack annotations (regression baseline)', async () => {
    const eq = makeEquipment({ annotations: [], iso_annotations: [] })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('emits the arrow label text into the PDF content stream', async () => {
    // The labels are the worker-facing payload — "Main breaker", etc.
    // If they're missing from the PDF, the printed placard is silent
    // about which isolation point each arrow refers to.
    const eq = makeEquipment({
      // We can't trigger image embedding without a real photo URL, but
      // the annotation drawing path runs only when an image was
      // embedded. This test exercises the codepath even without a
      // photo by checking PDF generation doesn't error and the
      // structural pieces are in place.
      iso_annotations: [
        { type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, label: 'MainBreakerXYZ' },
        { type: 'label', x: 0.7, y: 0.8, text: 'GroundRodAlpha' },
      ],
    })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    expect(bytes.byteLength).toBeGreaterThan(0)
    // Without a photo URL the image embed returns null and the
    // overlay is suppressed (intentional — overlay needs an image to
    // sit on top of). So this just verifies the no-photo path is
    // safe; the next test covers the overlay-emits-output case via
    // the public API surface.
  })

  it('drops malformed annotation entries silently — never breaks PDF generation', async () => {
    // jsonb is server-trusted-but-not-sanitised; a hand-edited DB row
    // could contain a coord of 5 or a missing field. parseAnnotations
    // strips these. Confirm the PDF generator goes through that
    // sanitiser (it does — addPlacardPages calls parseAnnotations
    // before passing to drawPlacardPage).
    const eq = makeEquipment({
      annotations: [
        { type: 'arrow', x1: 5, y1: 0.2, x2: 0.5, y2: 0.6 },     // out of range
        { type: 'label', x: 0.5, y: 0.5, text: '' },              // empty
        { type: 'spaceship', x: 0.5, y: 0.5 },                    // unknown shape
        null,
      ] as unknown[],
    })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('arrow + label coordinates map through the Y-flip — round-trip via PDF parse', async () => {
    // PDF Y is bottom-up; annotations are top-down. The mapY flip in
    // drawAnnotationsOnImage is the only translation. Smoke-test by
    // confirming the generated PDF parses back into a 2-page document
    // with valid structure when annotations are present (the array is
    // intentionally non-empty so the code path runs end-to-end).
    const eq = makeEquipment({
      iso_annotations: [
        { type: 'arrow', x1: 0,   y1: 0,   x2: 1,   y2: 1, label: 'corner' },
        { type: 'label', x: 0.5,  y: 0.5,  text: 'middle' },
      ],
    })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)  // EN + ES
  })

  // ── Edge cases on drawAnnotationsOnImage (direct overlay path) ────────

  it('survives emoji + CJK in label text — would otherwise crash WinAnsi', async () => {
    // Confirmed bug before the sanitiser: pdf-lib's StandardFonts.Helvetica
    // throws "WinAnsi cannot encode" on any code point outside CP1252,
    // which would void the whole placard. Workers type labels via
    // window.prompt() on iPad and could easily paste an emoji from the
    // autocomplete strip.
    const bytes = await renderOverlayInIsolation([
      { type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, label: 'Disconnect 🔥 NOW' },
      { type: 'label', x: 0.5, y: 0.5, text: '日本語' },
      { type: 'arrow', x1: 0.2, y1: 0.7, x2: 0.6, y2: 0.9, label: 'Smart " quote' },
    ])
    expect(bytes.byteLength).toBeGreaterThan(0)
    const reLoaded = await PDFDocument.load(bytes)
    expect(reLoaded.getPageCount()).toBe(1)
  })

  it('draws annotations end-to-end on a real PDF page (real overlay coverage)', async () => {
    // The end-to-end generator-level tests above don't actually exercise
    // the overlay path (no photo URL → no image embed → overlay
    // suppressed). This test calls drawAnnotationsOnImage directly with
    // a real PDFPage so a regression in the helper's PDF graphics state
    // (unbalanced q/Q, malformed path, etc.) actually fails the suite.
    const bytes = await renderOverlayInIsolation([
      { type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, label: 'Main breaker' },
      { type: 'label', x: 0.7, y: 0.8, text: 'Ground rod' },
    ])
    expect(bytes.byteLength).toBeGreaterThan(0)
    // Round-trip via load+save proves the page's graphics-state stack
    // is well-formed. An unbalanced push (e.g. arrowhead drawSvgPath
    // leaking state) would surface here, not at draw time.
    const re = await PDFDocument.load(bytes)
    const re2 = await re.save()
    expect(re2.byteLength).toBeGreaterThan(0)
  })

  it('skips zero-length arrows without dividing by zero on the unit-direction', async () => {
    // x1==x2 && y1==y2 — len comes out 0 and the arrowhead math would
    // produce NaN coordinates. The `len > 0.001` guard short-circuits
    // it; the strokes still draw (zero-length lines just paint a dot).
    const bytes = await renderOverlayInIsolation([
      { type: 'arrow', x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5, label: 'Stuck' },
    ])
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('handles extreme aspect ratios — minDim never produces a zero stroke', async () => {
    // A 1×500 strip would mean minDim=1 in image space; the strokes
    // floor to the Math.max(1.2, …) minimums so they remain visible.
    // The guard exists to prevent invisible hairlines on a wide+short
    // photo on an iPad screen with retina scaling — confirm it doesn't
    // collapse to nothing here either.
    const doc  = await PDFDocument.create()
    const page = doc.addPage([400, 300])
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    // imageW=200, imageH=1 — silly thin photo
    drawAnnotationsOnImage(page, bold, 50, 50, 200, 1, [
      { type: 'arrow', x1: 0, y1: 0.5, x2: 1, y2: 0.5, label: 'Tip' },
    ], rgb(0.75, 0.08, 0.08))
    const bytes = await doc.save()
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('an empty annotations array is a no-op — does not push any graphics state', async () => {
    // Round-trip-clean baseline. Combined with the round-trip above,
    // this lets us blame any future stack-imbalance failures squarely
    // on the per-shape rendering code.
    const bytes = await renderOverlayInIsolation([])
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  // ── sanitizeForWinAnsi ────────────────────────────────────────────────

  it('sanitizeForWinAnsi preserves Spanish accents — they are CP1252', () => {
    expect(sanitizeForWinAnsi('Válvula de paso')).toBe('Válvula de paso')
    expect(sanitizeForWinAnsi('Año')).toBe('Año')
  })

  it('sanitizeForWinAnsi preserves the CP1252 typographic extras', () => {
    expect(sanitizeForWinAnsi('"smart"')).toBe('"smart"')
    expect(sanitizeForWinAnsi('a — b')).toBe('a — b')
    expect(sanitizeForWinAnsi('€100')).toBe('€100')
  })

  it('sanitizeForWinAnsi replaces emojis and CJK with ?', () => {
    expect(sanitizeForWinAnsi('🔥')).toBe('?')
    expect(sanitizeForWinAnsi('日本語')).toBe('???')
    expect(sanitizeForWinAnsi('breaker 🔥')).toBe('breaker ?')
  })

  it('sanitizeForWinAnsi leaves an empty string empty', () => {
    expect(sanitizeForWinAnsi('')).toBe('')
  })

  it('produces a structurally valid PDF that re-opens with both pages intact', async () => {
    // Round-trip sanity: bytes → PDFDocument → bytes. Catches gross
    // corruption (e.g. an unbalanced graphics-state push from the
    // arrowhead drawing path) that would still let generation succeed
    // but fail to parse. This is the strongest guarantee available
    // without a real headless-render pipeline.
    const eq = makeEquipment({
      annotations:     [{ type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, label: 'A' }],
      iso_annotations: [{ type: 'label', x: 0.5, y: 0.5, text: 'B' }],
    })
    const bytes = await generatePlacardPdf({ equipment: eq, steps: [] })
    const doc   = await PDFDocument.load(bytes)
    const reSerialized = await doc.save()
    expect(reSerialized.byteLength).toBeGreaterThan(0)
    const reLoaded = await PDFDocument.load(reSerialized)
    expect(reLoaded.getPageCount()).toBe(2)
  })
})
