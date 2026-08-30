import { rgb, type PDFPage } from 'pdf-lib'
import { hexToRgb01 } from '@soteria/core/energyCodes'
import {
  DOT_HAZARD_CLASS_META,
  isValidDotHazardClass,
  type DotHazardClass,
} from '@soteria/core/hazardSymbols'

// DOT / UN transport placard renderer (PDF). Draws the on-point square
// placard — the 45-degree-rotated square with the hazard-class number in
// the bottom corner that 49 CFR 172 requires on transport containers.
//
// Mirrors drawGhsPictogram in lib/ghsPictograms.ts: a single entry point
// that takes a bounding box (x, y, size) and draws within it, doing nothing
// for an unknown class so the caller can fall back to text.
//
// The official placards carry a class-specific symbol (flame, skull, etc.)
// in the top half; here we draw the colored diamond + class number + an
// optional UN-number band, which is the legible, license-free subset the
// raster /dot/<id>.svg assets render in full. Color comes from
// DOT_HAZARD_CLASS_META.placardColor — the single source of truth shared
// with the React placard badge so screen and print agree.

const BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)

interface DrawPlacardOptions {
  /** DOT hazard class/division id, e.g. '3', '2.1', '6.1'. */
  id:            string
  /** Optional UN number; rendered as a white band, e.g. 'UN1993'. */
  unNumber?:     string | null
  /** Optional packing group (I/II/III); appended to the class corner. */
  packingGroup?: string | null
  /** Bottom-left of the bounding box (PDF coords, points). */
  x:             number
  y:             number
  /** Edge length of the bounding square the placard fills. */
  size:          number
}

// Pick legible text color (black/white) for a fill, by luminance. Light
// placards (white, yellow) take black text; dark ones (red, blue) take
// white — the same rule the printed DOT placards follow.
function textColorFor(hex: string): ReturnType<typeof rgb> {
  const [r, g, b] = hexToRgb01(hex)
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 0.6 ? BLACK : WHITE
}

function formatUnNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  return digits ? `UN${digits}` : null
}

/**
 * Draw a DOT placard (on-point colored square + class number) at the given
 * bounding box. Does nothing for an unknown class id.
 */
export function drawDotPlacard(page: PDFPage, opts: DrawPlacardOptions): void {
  if (!isValidDotHazardClass(opts.id)) return
  const meta = DOT_HAZARD_CLASS_META[opts.id as DotHazardClass]

  const cx = opts.x + opts.size / 2
  const cy = opts.y + opts.size / 2
  const half = opts.size / 2

  const fill = rgb(...hexToRgb01(meta.placardColor))
  const ink = textColorFor(meta.placardColor)

  // Colored diamond (on-point square) with a black border so a white or
  // yellow placard still reads as a distinct shape on a white page.
  page.drawSvgPath(`M 0 -${half} L ${half} 0 L 0 ${half} L -${half} 0 Z`, {
    x: cx,
    y: cy,
    color: fill,
    borderColor: BLACK,
    borderWidth: Math.max(0.75, opts.size * 0.025),
  })

  // Class/division number in the bottom corner — the regulation-mandated
  // identifier. We center it horizontally on the diamond using a Helvetica
  // digit-width approximation (~0.55em), since this drawer takes no font
  // (mirroring drawGhsPictogram's font-free signature).
  const classText = meta.division ?? String(meta.classNumber)
  const classSize = opts.size * 0.18
  const classWidth = classText.length * classSize * 0.55
  page.drawText(classText, {
    x: cx - classWidth / 2,
    y: cy - half + opts.size * 0.12,
    size: classSize,
    color: ink,
  })

  const unText = formatUnNumber(opts.unNumber)
  if (unText) {
    // White band across the middle carrying the UN number — the
    // pre-transport identification placards (49 CFR 172.332) use this.
    const bandH = opts.size * 0.22
    const bandW = opts.size * 0.7
    page.drawRectangle({
      x: cx - bandW / 2,
      y: cy - bandH / 2,
      width: bandW,
      height: bandH,
      color: WHITE,
      borderColor: BLACK,
      borderWidth: 0.5,
    })
    const unSize = opts.size * 0.13
    // Approximate centering: Helvetica avg digit/char width ~0.55em.
    const unWidth = unText.length * unSize * 0.55
    page.drawText(unText, {
      x: cx - unWidth / 2,
      y: cy - unSize * 0.45,
      size: unSize,
      color: BLACK,
    })
  }

  // Packing group sits just above center (between the symbol area and the
  // class number) so it never collides with the bottom-corner class number.
  const pg = opts.packingGroup?.trim()
  if (pg) {
    const pgText = `PG ${pg}`
    const pgSize = opts.size * 0.1
    const pgWidth = pgText.length * pgSize * 0.55
    page.drawText(pgText, {
      x: cx - pgWidth / 2,
      y: cy + opts.size * 0.18,
      size: pgSize,
      color: ink,
    })
  }
}
