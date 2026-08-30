import { rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { hexToRgb01 } from '@soteria/core/energyCodes'
import { NFPA_QUADRANT_HEX } from '@soteria/core/hazardSymbols'

// NFPA 704 fire-diamond renderer (PDF). Extracted from chemicalLabels.ts
// so the same on-point diamond serves chemical placards AND hazardous-
// waste labels without duplicating the geometry.
//
// The diamond stands on a point: red (flammability) top, blue (health)
// left, yellow (instability) right, white (special) bottom. Colors come
// from NFPA_QUADRANT_HEX — the single source of truth shared with the
// React component (Nfpa704Diamond.tsx) so screen and print match exactly.

const HEALTH       = rgb(...hexToRgb01(NFPA_QUADRANT_HEX.health))
const FLAMMABILITY = rgb(...hexToRgb01(NFPA_QUADRANT_HEX.flammability))
const INSTABILITY  = rgb(...hexToRgb01(NFPA_QUADRANT_HEX.instability))
const SPECIAL      = rgb(...hexToRgb01(NFPA_QUADRANT_HEX.special))
const BLACK        = rgb(0, 0, 0)
const WHITE        = rgb(1, 1, 1)

export interface Nfpa704Args {
  /** Center of the diamond in PDF coordinates (points). */
  cx:           number
  cy:           number
  /** Full diagonal of the outer diamond in points. */
  size:         number
  health:       number | null
  flammability: number | null
  instability:  number | null
  special:      string | null
}

/**
 * Draw an NFPA 704 fire diamond centered at (cx, cy). The white
 * (special) quadrant carries up to 3 characters; numeric quadrants show
 * the 0-4 rating or an en-dash when the rating is null.
 */
export function drawNfpa704Diamond(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  args: Nfpa704Args,
): void {
  const half = args.size / 2
  const cx = args.cx
  const cy = args.cy

  // Outer diamond — black frame the four colored quadrants sit inside.
  page.drawSvgPath(`M 0 -${half} L ${half} 0 L 0 ${half} L -${half} 0 Z`, {
    x: cx, y: cy, color: BLACK,
  })

  // Quadrants — translate the diamond so each quadrant is a smaller
  // diamond filled with its color, drawn slightly inset from the outer
  // border so the black diamond reads as the frame.
  const inset = args.size * 0.04
  const q = (half - inset) / 2

  // Blue (health) — left
  page.drawSvgPath(`M 0 -${q} L ${q} 0 L 0 ${q} L -${q} 0 Z`, {
    x: cx - q, y: cy, color: HEALTH,
  })
  // Red (flammability) — top
  page.drawSvgPath(`M 0 -${q} L ${q} 0 L 0 ${q} L -${q} 0 Z`, {
    x: cx, y: cy + q, color: FLAMMABILITY,
  })
  // Yellow (instability) — right
  page.drawSvgPath(`M 0 -${q} L ${q} 0 L 0 ${q} L -${q} 0 Z`, {
    x: cx + q, y: cy, color: INSTABILITY,
  })
  // White (special) — bottom
  page.drawSvgPath(`M 0 -${q} L ${q} 0 L 0 ${q} L -${q} 0 Z`, {
    x: cx, y: cy - q, color: SPECIAL,
    borderColor: BLACK, borderWidth: 0.5,
  })

  const fontSize = args.size * 0.18
  const drawCenter = (text: string, color: ReturnType<typeof rgb>, ox: number, oy: number) => {
    const w = bold.widthOfTextAtSize(text, fontSize)
    page.drawText(text, {
      x: cx + ox - w / 2,
      y: cy + oy - fontSize / 2 + 2,
      font: bold, size: fontSize, color,
    })
  }
  // Numbers on the colored quadrants read white; the special symbol on the
  // white quadrant reads black.
  drawCenter(args.health        !== null ? String(args.health)       : '–', WHITE, -q, 0)
  drawCenter(args.flammability  !== null ? String(args.flammability) : '–', WHITE,  0, q)
  drawCenter(args.instability   !== null ? String(args.instability)  : '–', WHITE,  q, 0)
  drawCenter(args.special && args.special.trim() ? args.special.trim().slice(0, 3) : '–', BLACK, 0, -q)

  // The font param keeps the signature parallel to the other PDF symbol
  // drawers (drawGhsPictogram-style) and leaves room for a future
  // non-bold legend without a breaking change.
  void font
}
