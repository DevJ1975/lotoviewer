// A printed LOTO placard must never present an incomplete procedure as if it
// were complete.
//
// The steps table is a fixed region on a letter-landscape sheet and rowH has a
// 30pt floor, so only about seven rows fit legibly. The draw loop simply
// stopped when it ran out of vertical space: on equipment with eight or more
// energy sources, step 8 onward vanished with no marker and no warning. A
// worker performing every step the sheet showed would reach the end and
// believe the machine was at zero energy while un-isolated sources were still
// live — the worst failure this product has.
//
// The remainder still cannot be shown on a fixed-size placard. What these
// tests pin is that overflow can never be SILENT: the last row is given over
// to a warning instead of a step.
//
// Counting is done against a recording page rather than by parsing the PDF —
// pdf-lib subsets the font, so drawn strings are glyph indices in the content
// stream, not searchable text.

import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib'
import { drawPlacardPage } from '@/lib/pdfPlacard'
import { PLACARD_TEXT } from '@/lib/placardText'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'

const PAGE_W = 792
const MARGIN = 18

const equipment = {
  id: 'eq-1', equipment_id: 'SKAP-1003', description: 'Case packer',
  department: 'Packaging', tenant_id: 't1',
} as unknown as Equipment

function steps(n: number): LotoEnergyStep[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, step_number: i + 1, energy_type: 'E',
    tag_description: `D${i + 1}`, isolation_procedure: `P${i + 1}`,
    method_of_verification: `V${i + 1}`,
  })) as unknown as LotoEnergyStep[]
}

interface Rendered { rows: number; bannerDrawn: boolean }

/**
 * Render one placard page and count what the steps table actually produced.
 * A step row is identified by the full-width separator the loop draws at its
 * bottom edge; the overflow banner by its full-width filled rectangle in the
 * table's red.
 */
async function render(stepCount: number, language: 'en' | 'es' = 'en'): Promise<Rendered> {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, 612])

  let rows = 0
  let bannerDrawn = false
  const realLine = page.drawLine.bind(page)
  const realText = page.drawText.bind(page)

  ;(page as PDFPage).drawLine = (o: Parameters<PDFPage['drawLine']>[0]) => {
    const full = o?.start?.x === MARGIN && o?.end?.x === PAGE_W - MARGIN
    if (full && o.start.y === o.end.y) rows++
    return realLine(o)
  }
  ;(page as PDFPage).drawText = (t: string, o: Parameters<PDFPage['drawText']>[1]) => {
    // The banner is the only place the truncation copy appears.
    const marker = PLACARD_TEXT.stepsTruncated[language].split('{n}')[0].trim()
    if (typeof t === 'string' && marker && t.includes(marker.slice(0, 12))) bannerDrawn = true
    return realText(t, o)
  }

  drawPlacardPage(page, { regular, bold }, {
    language, equipment, steps: steps(stepCount),
  } as unknown as Parameters<typeof drawPlacardPage>[2])

  return { rows, bannerDrawn }
}

describe('placard step table — a short procedure prints in full', () => {
  it.each([1, 2, 3, 5, 6, 7])('renders every step when %i fit', async n => {
    const { rows, bannerDrawn } = await render(n)
    expect(rows, `${n} steps supplied`).toBe(n)
    // Nothing was withheld, so nothing to warn about.
    expect(bannerDrawn).toBe(false)
  })
})

describe('placard step table — a long procedure declares itself incomplete', () => {
  it.each([8, 9, 10, 12, 15, 20, 40])('warns instead of silently dropping at %i steps', async n => {
    const { rows, bannerDrawn } = await render(n)

    // THE invariant. Before the fix this was false: the sheet showed seven
    // steps of twenty and said nothing.
    expect(bannerDrawn, `${n} steps overflowed with no warning banner`).toBe(true)

    // The banner occupies a row, so fewer steps show than physically fit —
    // that is the trade being made deliberately.
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThan(n)
  })

  it('warns in Spanish on the Spanish page too', async () => {
    // The ES sheet is posted beside the EN one; a warning on only one of them
    // would leave half the crew reading a placard that looks complete.
    const { bannerDrawn } = await render(12, 'es')
    expect(bannerDrawn).toBe(true)
  })

  it('names how many steps are missing rather than warning vaguely', () => {
    // "some steps omitted" gives a supervisor nothing to reconcile against.
    for (const lang of ['en', 'es'] as const) {
      expect(PLACARD_TEXT.stepsTruncated[lang]).toContain('{n}')
    }
  })
})
