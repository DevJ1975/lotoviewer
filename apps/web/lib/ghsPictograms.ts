import { PDFPage, rgb } from 'pdf-lib'
import type { GhsPictogram } from '@soteria/core/chemicals'

// Drawing primitives for the nine GHS pictograms in PDF.
//
// Why procedural? The official UN GHS artwork is freely
// redistributable, but bundling raster PNGs adds ~50 KB per
// pictogram and requires a build-time fetch. pdf-lib supports
// drawSvgPath, so we emit each symbol as a path string and let
// pdf-lib rasterize at print resolution. Output reads as the
// canonical "red diamond on point with black symbol on white".
//
// Path coordinates use a 100×100 viewbox CENTERED ON THE DIAMOND
// (i.e. {-50, -50} → {50, 50}). The wrapper drawGhsPictogram
// translates + scales for the caller.
//
// Caveat: these are the LIBRARY's interpretation of the GHS
// symbols, not pixel-perfect copies of the UN artwork. They are
// recognizable and consistent with the reference symbols, but for
// final regulatory submissions a tenant may prefer the official
// artwork — see docs/chemical-management-system-plan.md §5.3 for
// the swap path.

const RED   = rgb(0xC0 / 255, 0x16 / 255, 0x22 / 255)
const BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)

// The diamond outline as an SVG path. Standing on a point, top at
// (0, -45), right at (45, 0), bottom at (0, 45), left at (-45, 0).
// Drawn with a thick red border + white fill so the inner symbol
// is unambiguously legible.
const DIAMOND_PATH = 'M 0 -45 L 45 0 L 0 45 L -45 0 Z'

// ── Symbol paths (centered on origin, ~30 unit fit window) ────────────────

const SYMBOL_PATHS: Record<GhsPictogram, string> = {
  // GHS01 Explosive — burst lines radiating from a circle
  GHS01: [
    'M 0 -22 L 4 -8 L 18 -16 L 8 -2 L 22 4 L 6 4 L 12 18 L 0 8 L -12 18 L -6 4 L -22 4 L -8 -2 L -18 -16 L -4 -8 Z',
  ].join(' '),

  // GHS02 Flammable — a flame
  GHS02: [
    // Outer flame outline
    'M -12 24 C -22 12 -10 6 -8 -4 C -6 6 4 0 0 -10 C 6 -2 14 -2 14 8 C 14 18 6 24 -12 24 Z',
    // Inner core (white-cut for contrast — actual draw uses fill rule)
  ].join(' '),

  // GHS03 Oxidizing — flame above a circle (the "O")
  GHS03: [
    // Flame
    'M -8 -2 C -14 -10 -6 -16 -4 -22 C -2 -16 4 -18 2 -24 C 8 -18 14 -16 12 -8 C 10 0 0 4 -8 -2 Z',
    // Circle below
    'M -18 14 a 18 18 0 1 0 36 0 a 18 18 0 1 0 -36 0 Z',
    // Inner cut so the O reads
    'M -10 14 a 10 10 0 1 1 20 0 a 10 10 0 1 1 -20 0 Z',
  ].join(' '),

  // GHS04 Compressed gas — a vertical cylinder
  GHS04: [
    // Body
    'M -10 -20 L 10 -20 L 10 22 L -10 22 Z',
    // Valve cap
    'M -4 -26 L 4 -26 L 4 -20 L -4 -20 Z',
    // Belly band
    'M -10 4 L 10 4 L 10 8 L -10 8 Z',
  ].join(' '),

  // GHS05 Corrosive — corroding plate + corroding hand silhouette,
  // simplified as two corrosive drips
  GHS05: [
    // Test tube (left, on a plate)
    'M -22 -16 L -10 -16 L -10 0 L -16 6 L -22 0 Z',
    // Plate under test tube (with drip)
    'M -28 8 L -8 8 L -10 14 L -26 14 Z',
    // Hand silhouette (right)
    'M 6 -10 L 26 -10 L 26 6 L 22 12 L 14 14 L 8 10 Z',
    // Drip running off hand
    'M 14 14 L 16 24 L 18 14 Z',
  ].join(' '),

  // GHS06 Acute toxicity — skull and crossbones (very simplified)
  GHS06: [
    // Skull
    'M -16 -18 a 16 16 0 1 1 32 0 v 12 a 6 6 0 0 1 -6 6 h -4 v 6 h -12 v -6 h -4 a 6 6 0 0 1 -6 -6 Z',
    // Crossbones — diagonal ovals
    'M -22 14 L 22 22 L 22 26 L -22 18 Z',
    'M -22 22 L 22 14 L 22 18 L -22 26 Z',
  ].join(' '),

  // GHS07 Harmful / irritant — exclamation mark
  GHS07: [
    // Stroke (thick rectangle)
    'M -4 -22 L 4 -22 L 6 8 L -6 8 Z',
    // Dot
    'M -5 14 L 5 14 L 5 24 L -5 24 Z',
  ].join(' '),

  // GHS08 Health hazard — silhouette of person with starburst over chest
  GHS08: [
    // Head + shoulders silhouette
    'M -8 -22 a 8 8 0 1 1 16 0 a 8 8 0 1 1 -16 0 Z',
    'M -16 -8 L 16 -8 L 14 22 L -14 22 Z',
    // Starburst (8-point) over chest, drawn as an inset
    'M 0 -2 L 4 6 L 12 4 L 6 10 L 14 14 L 6 14 L 8 22 L 0 16 L -8 22 L -6 14 L -14 14 L -6 10 L -12 4 L -4 6 Z',
  ].join(' '),

  // GHS09 Environmental hazard — dead fish + leafless tree
  GHS09: [
    // Wave line (water)
    'M -24 16 L -16 12 L -8 16 L 0 12 L 8 16 L 16 12 L 24 16 L 24 22 L -24 22 Z',
    // Dead fish (X eye, body)
    'M -22 4 L -10 -2 L -2 -2 L -2 8 L -10 8 L -22 14 L -18 8 L -18 4 Z',
    // Tree trunk
    'M 12 -22 L 16 -22 L 16 8 L 12 8 Z',
    // Leafless branches
    'M 14 -22 L 22 -28 L 16 -22 L 22 -16 L 16 -16 L 22 -8 L 16 -10 Z',
  ].join(' '),
}

interface DrawOptions {
  /** Bottom-left of the bounding box (PDF coords, points). */
  x:    number
  y:    number
  /** Edge length of the bounding square; pictogram fills it. */
  size: number
  /** Border thickness in points. Defaults to size * 0.04. */
  borderWidth?: number
  /** Skip the white fill (e.g. for very small thumbnail sizes). */
  fillWhite?: boolean
}

/**
 * Draw a GHS pictogram (red diamond + black symbol on white) at the
 * given location. Does nothing for unknown codes — the caller can
 * fall back to a textual badge if needed.
 */
export function drawGhsPictogram(
  page: PDFPage,
  code: GhsPictogram,
  opts: DrawOptions,
): void {
  const symbolPath = SYMBOL_PATHS[code]
  if (!symbolPath) return

  const cx = opts.x + opts.size / 2
  const cy = opts.y + opts.size / 2
  // 90 in path units spans the diamond (45 either side); scale to the
  // caller's bounding box.
  const scale = opts.size / 100

  // Diamond border (filled red), then white inner so the cut feels
  // crisp without computing a path-difference.
  page.drawSvgPath(DIAMOND_PATH, {
    x: cx,
    y: cy,
    scale,
    color: RED,
    borderColor: BLACK,
    borderWidth: opts.borderWidth ?? Math.max(0.5, opts.size * 0.02),
  })
  // Inner white diamond, slightly smaller so the red shows as a frame.
  if (opts.fillWhite !== false) {
    const innerScale = scale * 0.86
    page.drawSvgPath(DIAMOND_PATH, {
      x: cx,
      y: cy,
      scale: innerScale,
      color: WHITE,
      borderColor: WHITE,
      borderWidth: 0,
    })
  }
  // Black symbol on top, scaled to the inner area.
  const symbolScale = scale * 0.7
  page.drawSvgPath(symbolPath, {
    x: cx,
    y: cy,
    scale: symbolScale,
    color: BLACK,
    borderColor: BLACK,
    borderWidth: Math.max(0.3, symbolScale),
  })
}

export const GHS_PICTOGRAM_CODES: readonly GhsPictogram[] = Object.keys(SYMBOL_PATHS) as GhsPictogram[]
