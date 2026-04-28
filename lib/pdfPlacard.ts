import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts, degrees, rgb } from 'pdf-lib'
import { ENERGY_CODES, energyCodeFor, hexToRgb01 } from '@/lib/energyCodes'
import { PLACARD_TEXT } from '@/lib/placardText'
import { type Annotation, parseAnnotations } from '@/lib/photoAnnotations'
import type { Equipment, LotoEnergyStep } from '@/lib/types'

// ── Constants ───────────────────────────────────────────────────────────────
const PAGE_W = 792
const PAGE_H = 612
const MARGIN = 18

const COLOR_YELLOW_BAND = rgb(...hexToRgb01('#FFD900'))
const COLOR_BLUE_BAR    = rgb(...hexToRgb01('#D9E8FF'))
const COLOR_RED_BLOCK   = rgb(...hexToRgb01('#BF1414'))
const COLOR_NAVY_HEADER = rgb(...hexToRgb01('#214488'))
const COLOR_GRAY_LEGEND = rgb(0.92, 0.92, 0.92)
const COLOR_WHITE       = rgb(1, 1, 1)
const COLOR_BLACK       = rgb(0, 0, 0)
const COLOR_ROW_ALT     = rgb(0.96, 0.97, 0.99)
const COLOR_TABLE_BORDER = rgb(0.82, 0.85, 0.90)
const COLOR_SLATE_TEXT  = rgb(0.15, 0.18, 0.23)

// (All text strings come from PLACARD_TEXT — see lib/placardText.ts)

// ── Text helpers ────────────────────────────────────────────────────────────
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  const paragraphs = text.split(/\r?\n/)
  for (const para of paragraphs) {
    if (!para.trim()) { lines.push(''); continue }
    const words = para.split(/\s+/)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate
      } else {
        if (current) lines.push(current)
        // Word longer than line — hard break it
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = ''
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
              lines.push(chunk)
              chunk = ch
            } else {
              chunk += ch
            }
          }
          current = chunk
        } else {
          current = word
        }
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

function drawWrapped(page: PDFPage, text: string, opts: {
  x: number; y: number; maxWidth: number;
  font: PDFFont; size: number; color: RGB; lineHeight?: number;
  maxLines?: number;
}): number {
  const { x, y, maxWidth, font, size, color, lineHeight = size * 1.25, maxLines } = opts
  let lines = wrapText(text, font, size, maxWidth)
  if (maxLines && lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    lines[lines.length - 1] = lines[lines.length - 1].replace(/.{0,3}$/, '…')
  }
  let cy = y
  for (const line of lines) {
    page.drawText(line, { x, y: cy, size, font, color })
    cy -= lineHeight
  }
  return cy
}

// ── Image fetch + embed ─────────────────────────────────────────────────────
async function fetchAndEmbedImage(pdfDoc: PDFDocument, url: string | null | undefined) {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    const lower = url.toLowerCase()
    if (ct.includes('png') || lower.endsWith('.png')) {
      return await pdfDoc.embedPng(bytes)
    }
    return await pdfDoc.embedJpg(bytes)
  } catch {
    return null
  }
}

// ── Annotation overlay (matches AnnotationLayer in components/AnnotatedPhoto.tsx) ──
//
// PDF coordinate space is Y-up with origin at bottom-left. Annotation
// shapes use 0-1 image space with Y-down (matching SVG / the on-screen
// renderer). The `mapY` flip below is the only translation needed.

// pdf-lib's StandardFonts.Helvetica uses WinAnsiEncoding (CP1252).
// Anything outside that — emojis, CJK, control chars — throws on
// drawText. Workers type annotation labels via window.prompt() on
// iPad and could easily paste an emoji from autocomplete; without
// this sanitiser, one bad character would void the whole PDF.
//
// The kept set is CP1252: ASCII printable, Latin-1 supplement, plus
// the CP1252-specific code points (Euro sign, smart quotes, em/en
// dashes, typographic apostrophes, bullet, ellipsis, etc.). Everything
// else collapses to '?' so the label still occupies its place on the
// page even if a glyph is lost.
//
// Exported for unit testing — the regex enumeration is fragile enough
// that direct-coverage tests are more useful than re-deriving it.
export function sanitizeForWinAnsi(s: string): string {
  // The /u flag is critical: without it, supplementary-plane chars
  // (e.g. 🔥 = U+1F525) are seen as TWO surrogate-pair code units and
  // each half gets replaced separately, producing '??' instead of '?'.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[^\x20-\x7E\xA0-\xFF€ŒœŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›™]/gu, '?')
}

// Draw text with a simulated white halo for legibility against any
// photo background. pdf-lib has no paint-order/text-stroke support, so
// we draw the text 8 times offset by 1pt in white, then once on top in
// the dark color. Matches the visual weight of the SVG overlay's
// stroke="white" + paintOrder="stroke" trick.
function drawHaloedText(page: PDFPage, text: string, opts: {
  x: number; y: number;
  font: PDFFont; size: number;
  color: RGB; halo?: RGB;
  align?: 'center' | 'left';
}) {
  const { x, y, font, size, color, halo = COLOR_WHITE, align = 'center' } = opts
  const safe = sanitizeForWinAnsi(text)
  if (!safe) return
  const w = font.widthOfTextAtSize(safe, size)
  const drawX = align === 'center' ? x - w / 2 : x
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      if (dx === 0 && dy === 0) continue
      page.drawText(safe, { x: drawX + dx, y: y + dy, size, font, color: halo })
    }
  }
  page.drawText(safe, { x: drawX, y, size, font, color })
}

export function drawAnnotationsOnImage(
  page: PDFPage,
  bold: PDFFont,
  imageX: number, imageY: number,
  imageW: number, imageH: number,
  annotations: Annotation[],
  color: RGB,
) {
  // drawSvgPath translates SVG coordinates to PDF Y-up via the page's
  // own height, so we read it from the page rather than hardcoding
  // PAGE_H — keeps the helper reusable on any page size.
  const pageHeight = page.getHeight()
  if (!annotations.length) return
  const minDim   = Math.min(imageW, imageH)
  const haloThk  = Math.max(1.2, 0.012 * minDim)
  const lineThk  = Math.max(0.8, 0.008 * minDim)
  const arrowH   = Math.max(4,   0.05  * minDim)   // arrowhead length
  const arrowW   = Math.max(2.5, 0.025 * minDim)   // arrowhead half-width
  const labelSz  = Math.max(6,   0.045 * minDim)

  // 0-1 image space → PDF page coords. Y is flipped because annotations
  // measure from the top of the image (SVG convention), PDF measures
  // from the bottom of the page.
  const mapX = (x: number) => imageX + x * imageW
  const mapY = (y: number) => imageY + (1 - y) * imageH

  for (const shape of annotations) {
    if (shape.type === 'arrow') {
      const sx = mapX(shape.x1), sy = mapY(shape.y1)
      const ex = mapX(shape.x2), ey = mapY(shape.y2)

      // White halo behind the colored stroke — keeps the arrow visible
      // on dark photos, same trick the SVG renderer uses.
      page.drawLine({
        start: { x: sx, y: sy }, end: { x: ex, y: ey },
        thickness: haloThk, color: COLOR_WHITE,
      })
      page.drawLine({
        start: { x: sx, y: sy }, end: { x: ex, y: ey },
        thickness: lineThk, color,
      })

      // Filled arrowhead triangle at the tip. pdf-lib's drawSvgPath
      // expects SVG-space coordinates (Y-down from page top), so we
      // convert each PDF-Y-up vertex back via PAGE_H − y.
      const dx = ex - sx, dy = ey - sy
      const len = Math.hypot(dx, dy)
      if (len > 0.001) {
        const ux = dx / len, uy = dy / len
        const px = -uy,      py = ux
        const baseX = ex - arrowH * ux
        const baseY = ey - arrowH * uy
        const lX = baseX + arrowW * px, lY = baseY + arrowW * py
        const rX = baseX - arrowW * px, rY = baseY - arrowW * py
        const triPath =
          `M ${ex} ${pageHeight - ey} ` +
          `L ${lX} ${pageHeight - lY} ` +
          `L ${rX} ${pageHeight - rY} Z`
        page.drawSvgPath(triPath, {
          color,
          borderColor: COLOR_WHITE,
          // Scale the white halo with the rest of the overlay so it
          // doesn't dominate tiny photos or vanish on huge ones.
          borderWidth: Math.max(0.4, lineThk * 0.5),
        })
      }

      if (shape.label) {
        // Label sits just above the arrowhead — same offset (-0.02 in
        // image space) the SVG uses, so on-screen and on-paper align.
        const labelY = mapY(shape.y2 - 0.02) - labelSz * 0.2
        drawHaloedText(page, shape.label, {
          x: ex, y: labelY,
          font: bold, size: labelSz,
          color: COLOR_SLATE_TEXT, halo: COLOR_WHITE,
          align: 'center',
        })
      }
    } else {
      // Standalone label
      const lx = mapX(shape.x), ly = mapY(shape.y) - labelSz * 0.35
      drawHaloedText(page, shape.text, {
        x: lx, y: ly,
        font: bold, size: labelSz,
        color: COLOR_SLATE_TEXT, halo: COLOR_WHITE,
        align: 'center',
      })
    }
  }
}

// ── Page renderer ───────────────────────────────────────────────────────────
export interface PlacardPageOptions {
  language:         'en' | 'es'
  equipment:        Equipment
  steps:            LotoEnergyStep[]
  equipImage:       Awaited<ReturnType<typeof fetchAndEmbedImage>>
  isoImage:         Awaited<ReturnType<typeof fetchAndEmbedImage>>
  // Parsed annotation overlays for each photo. Both default to empty
  // when unspecified so older callers keep working unchanged.
  equipAnnotations?: Annotation[]
  isoAnnotations?:   Annotation[]
  dateStr:          string
  draft:            boolean  // show "BORRADOR — NO REVISADO" watermark
}

export function drawPlacardPage(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  opts: PlacardPageOptions,
) {
  const {
    language, equipment, steps,
    equipImage, isoImage,
    equipAnnotations = [], isoAnnotations = [],
    dateStr, draft,
  } = opts
  const isEn = language === 'en'
  const { regular, bold } = fonts

  // y-bands (top → bottom)
  const Y_YELLOW_TOP   = PAGE_H
  const Y_YELLOW_BOT   = Y_YELLOW_TOP - 44
  const Y_BLUE_BOT     = Y_YELLOW_BOT - 20
  const Y_RED_BOT      = Y_BLUE_BOT - 30
  const Y_COLS_BOT     = Y_RED_BOT - 72
  const Y_LEGEND_BOT   = Y_COLS_BOT - 14
  const Y_NAVYHDR_BOT  = Y_LEGEND_BOT - 13
  const Y_PHOTOS_BOT   = Y_NAVYHDR_BOT - 110
  const Y_TABLE_BOT    = 18
  const Y_SIG_BOT      = 0

  // ── 1. Yellow band ────────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: Y_YELLOW_BOT, width: PAGE_W, height: 44,
    color: COLOR_YELLOW_BAND,
  })
  // Logo badge left (simple navy square with "SL" text)
  page.drawRectangle({
    x: 12, y: Y_YELLOW_BOT + 7, width: 30, height: 30,
    color: COLOR_NAVY_HEADER,
  })
  page.drawText('SL', {
    x: 20, y: Y_YELLOW_BOT + 16, size: 13, font: bold, color: COLOR_YELLOW_BAND,
  })
  // Title centered
  const title = PLACARD_TEXT.title[language]
  const titleW = bold.widthOfTextAtSize(title, 17)
  page.drawText(title, {
    x: (PAGE_W - titleW) / 2, y: Y_YELLOW_BOT + 15,
    size: 17, font: bold, color: COLOR_BLACK,
  })
  // Date right
  const dateLabel = isEn ? `Date: ${dateStr}` : `Fecha: ${dateStr}`
  const dateW = regular.widthOfTextAtSize(dateLabel, 10)
  page.drawText(dateLabel, {
    x: PAGE_W - dateW - 14, y: Y_YELLOW_BOT + 17,
    size: 10, font: regular, color: COLOR_BLACK,
  })
  // Small EN/ES tag top-right corner
  const tagText = isEn ? 'EN' : 'ES'
  const tagColor = isEn ? COLOR_NAVY_HEADER : COLOR_RED_BLOCK
  page.drawRectangle({
    x: PAGE_W - 28, y: PAGE_H - 14, width: 22, height: 12,
    color: tagColor,
    borderColor: COLOR_WHITE, borderWidth: 0.5,
  })
  page.drawText(tagText, {
    x: PAGE_W - 22, y: PAGE_H - 11,
    size: 8, font: bold, color: COLOR_WHITE,
  })

  // ── 2. Blue bar ──────────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: Y_BLUE_BOT, width: PAGE_W, height: 20,
    color: COLOR_BLUE_BAR,
  })
  const equipLabel = `${PLACARD_TEXT.equipmentLabel[language]} `
  const equipLabelW = bold.widthOfTextAtSize(equipLabel, 11)
  page.drawText(equipLabel, {
    x: MARGIN, y: Y_BLUE_BOT + 6, size: 11, font: bold, color: COLOR_NAVY_HEADER,
  })
  const descAvailW = PAGE_W - MARGIN - equipLabelW - MARGIN - 80
  const descLines = wrapText(equipment.description, regular, 11, descAvailW)
  page.drawText(descLines[0] ?? '', {
    x: MARGIN + equipLabelW, y: Y_BLUE_BOT + 6,
    size: 11, font: regular, color: COLOR_SLATE_TEXT,
  })
  // Department right-aligned
  const deptText = equipment.department
  const deptW = bold.widthOfTextAtSize(deptText, 11)
  page.drawText(deptText, {
    x: PAGE_W - deptW - MARGIN, y: Y_BLUE_BOT + 6,
    size: 11, font: bold, color: COLOR_NAVY_HEADER,
  })

  // ── 3. Red warning block ─────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: Y_RED_BOT, width: PAGE_W, height: 30,
    color: COLOR_RED_BLOCK,
  })
  const warnHeader = PLACARD_TEXT.warningHeader[language]
  const warnW = bold.widthOfTextAtSize(warnHeader, 10)
  page.drawText(warnHeader, {
    x: (PAGE_W - warnW) / 2, y: Y_RED_BOT + 18,
    size: 10, font: bold, color: COLOR_WHITE,
  })
  const notesText = (isEn
    ? (equipment.notes?.trim()    ? equipment.notes    : PLACARD_TEXT.warningFallback.en)
    : (equipment.notes_es?.trim() ? equipment.notes_es : PLACARD_TEXT.warningFallback.es)) as string
  const notesLines = wrapText(notesText, regular, 8, PAGE_W - 40)
  page.drawText(notesLines[0] ?? '', {
    x: 20, y: Y_RED_BOT + 6,
    size: 8, font: regular, color: COLOR_WHITE,
  })

  // ── 4. Two-column section ────────────────────────────────────────────────
  const colL_W = (PAGE_W * 0.55) - MARGIN - 6
  const colR_X = PAGE_W * 0.55 + 6
  const colR_W = PAGE_W - colR_X - MARGIN
  const COLS_TOP = Y_RED_BOT - 4
  // Left heading
  page.drawText(PLACARD_TEXT.purposeHeader[language], {
    x: MARGIN, y: COLS_TOP - 10,
    size: 9, font: bold, color: COLOR_NAVY_HEADER,
  })
  drawWrapped(page, PLACARD_TEXT.purposeBody[language], {
    x: MARGIN, y: COLS_TOP - 22,
    maxWidth: colL_W, font: regular, size: 8,
    color: COLOR_SLATE_TEXT, lineHeight: 10, maxLines: 6,
  })
  // Right heading
  page.drawText(PLACARD_TEXT.stepsHeader[language], {
    x: colR_X, y: COLS_TOP - 10,
    size: 9, font: bold, color: COLOR_NAVY_HEADER,
  })
  const steps_list = PLACARD_TEXT.steps[language]
  let stepY = COLS_TOP - 22
  for (let i = 0; i < steps_list.length; i++) {
    if (stepY < Y_COLS_BOT + 4) break
    const line = `${i + 1}. ${steps_list[i]}`
    const wrapped = wrapText(line, regular, 8, colR_W)
    for (const w of wrapped) {
      if (stepY < Y_COLS_BOT + 4) break
      page.drawText(w, { x: colR_X, y: stepY, size: 8, font: regular, color: COLOR_SLATE_TEXT })
      stepY -= 10
    }
  }

  // ── 5. Gray legend bar ───────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: Y_LEGEND_BOT, width: PAGE_W, height: 14,
    color: COLOR_GRAY_LEGEND,
  })
  let legendX = MARGIN
  for (const ec of ENERGY_CODES) {
    const label = isEn ? ec.labelEn : ec.labelEs
    const chipText = `${ec.code}`
    const chipTextW = bold.widthOfTextAtSize(chipText, 7)
    // Colored chip
    page.drawRectangle({
      x: legendX, y: Y_LEGEND_BOT + 2, width: chipTextW + 6, height: 10,
      color: rgb(...hexToRgb01(ec.hex)),
    })
    page.drawText(chipText, {
      x: legendX + 3, y: Y_LEGEND_BOT + 4,
      size: 7, font: bold, color: rgb(...hexToRgb01(ec.textHex)),
    })
    // Label
    page.drawText(label, {
      x: legendX + chipTextW + 9, y: Y_LEGEND_BOT + 4,
      size: 7, font: regular, color: COLOR_SLATE_TEXT,
    })
    legendX += chipTextW + 9 + regular.widthOfTextAtSize(label, 7) + 10
  }

  // ── 6. Navy section header ───────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: Y_NAVYHDR_BOT, width: PAGE_W, height: 13,
    color: COLOR_NAVY_HEADER,
  })
  const sectionTitle = PLACARD_TEXT.sectionHeader[language]
  page.drawText(sectionTitle, {
    x: MARGIN, y: Y_NAVYHDR_BOT + 3,
    size: 9, font: bold, color: COLOR_WHITE,
  })

  // ── 7. Side-by-side photo slots ──────────────────────────────────────────
  const photoH      = 100
  const photoY      = Y_PHOTOS_BOT + 5
  const photoSlotW  = (PAGE_W - MARGIN * 3) / 2
  const photoLX     = MARGIN
  const photoRX     = MARGIN + photoSlotW + MARGIN

  function drawPhotoSlot(
    x: number, image: typeof equipImage, caption: string,
    annotations: Annotation[], overlayColor: RGB,
  ) {
    page.drawRectangle({
      x, y: photoY, width: photoSlotW, height: photoH,
      color: rgb(0.96, 0.97, 0.98),
      borderColor: COLOR_TABLE_BORDER, borderWidth: 0.5,
    })
    if (image) {
      const imgW = image.width
      const imgH = image.height
      const scale = Math.min((photoSlotW - 8) / imgW, (photoH - 18) / imgH)
      const drawW = imgW * scale
      const drawH = imgH * scale
      const drawX = x + (photoSlotW - drawW) / 2
      const drawY = photoY + 14 + (photoH - 18 - drawH) / 2
      page.drawImage(image, { x: drawX, y: drawY, width: drawW, height: drawH })
      // Overlay arrows + labels onto the just-drawn image. Same shape
      // data the on-screen renderer uses, scaled into PDF points.
      drawAnnotationsOnImage(page, bold, drawX, drawY, drawW, drawH, annotations, overlayColor)
    } else {
      const placeholder = isEn ? '— No photo —' : '— Sin foto —'
      const w = regular.widthOfTextAtSize(placeholder, 10)
      page.drawText(placeholder, {
        x: x + (photoSlotW - w) / 2,
        y: photoY + photoH / 2 - 2,
        size: 10, font: regular, color: rgb(0.6, 0.6, 0.65),
      })
    }
    page.drawText(caption, {
      x: x + 4, y: photoY + 3,
      size: 7.5, font: bold, color: COLOR_NAVY_HEADER,
    })
  }
  drawPhotoSlot(
    photoLX, equipImage, PLACARD_TEXT.photoCaptions[language].equipment.toUpperCase(),
    equipAnnotations, COLOR_NAVY_HEADER,
  )
  drawPhotoSlot(
    photoRX, isoImage, PLACARD_TEXT.photoCaptions[language].isolation.toUpperCase(),
    isoAnnotations, COLOR_RED_BLOCK,
  )

  // ── 8. Energy steps table ────────────────────────────────────────────────
  const tableTop    = Y_PHOTOS_BOT
  const tableBottom = Y_TABLE_BOT + 8
  const tableH      = tableTop - tableBottom
  const hdrH        = 14
  const colBadgeW   = 100                // tag badge + description
  const col1W       = Math.floor((PAGE_W - MARGIN * 2 - colBadgeW) * 0.5)
  const col2W       = PAGE_W - MARGIN * 2 - colBadgeW - col1W

  const hdrY = tableTop - hdrH
  page.drawRectangle({
    x: MARGIN, y: hdrY, width: PAGE_W - MARGIN * 2, height: hdrH,
    color: COLOR_NAVY_HEADER,
  })
  const [hdr1, hdr2, hdr3] = PLACARD_TEXT.tableHeaders[language]
  page.drawText(hdr1, { x: MARGIN + 6, y: hdrY + 4, size: 8, font: bold, color: COLOR_WHITE })
  page.drawText(hdr2, { x: MARGIN + colBadgeW + 6, y: hdrY + 4, size: 8, font: bold, color: COLOR_WHITE })
  page.drawText(hdr3, { x: MARGIN + colBadgeW + col1W + 6, y: hdrY + 4, size: 8, font: bold, color: COLOR_WHITE })

  const dataTop = hdrY
  const dataH   = tableH - hdrH
  const rowCount = Math.max(steps.length, 1)
  const rowH     = Math.max(30, Math.min(80, dataH / rowCount))

  let rowY = dataTop
  for (let i = 0; i < steps.length && rowY - rowH >= tableBottom - 2; i++) {
    const s = rowY - rowH
    if (i % 2 === 1) {
      page.drawRectangle({
        x: MARGIN, y: s, width: PAGE_W - MARGIN * 2, height: rowH,
        color: COLOR_ROW_ALT,
      })
    }
    // Borders
    page.drawLine({ start: { x: MARGIN, y: s }, end: { x: PAGE_W - MARGIN, y: s }, thickness: 0.4, color: COLOR_TABLE_BORDER })

    const step = steps[i]
    const ec = energyCodeFor(step.energy_type)

    // Badge
    const chipW = 30
    page.drawRectangle({
      x: MARGIN + 6, y: rowY - 14, width: chipW, height: 11,
      color: rgb(...hexToRgb01(ec.hex)),
    })
    page.drawText(step.energy_type, {
      x: MARGIN + 10, y: rowY - 12,
      size: 8, font: bold, color: rgb(...hexToRgb01(ec.textHex)),
    })

    // Description text
    const descRaw = isEn
      ? (step.tag_description ?? '')
      : (step.tag_description_es?.trim() ? step.tag_description_es : step.tag_description ?? '')
    drawWrapped(page, descRaw, {
      x: MARGIN + 6, y: rowY - 26,
      maxWidth: colBadgeW - 12, font: regular, size: 7,
      color: COLOR_SLATE_TEXT, lineHeight: 8.5, maxLines: Math.floor((rowH - 14) / 8.5),
    })

    // Isolation & lockout
    const procRaw = isEn
      ? (step.isolation_procedure ?? '')
      : (step.isolation_procedure_es?.trim() ? step.isolation_procedure_es : step.isolation_procedure ?? '')
    drawWrapped(page, procRaw, {
      x: MARGIN + colBadgeW + 6, y: rowY - 12,
      maxWidth: col1W - 12, font: regular, size: 7.5,
      color: COLOR_SLATE_TEXT, lineHeight: 9, maxLines: Math.floor((rowH - 6) / 9),
    })

    // Verification
    const verRaw = isEn
      ? (step.method_of_verification ?? '')
      : (step.method_of_verification_es?.trim() ? step.method_of_verification_es : step.method_of_verification ?? '')
    drawWrapped(page, verRaw, {
      x: MARGIN + colBadgeW + col1W + 6, y: rowY - 12,
      maxWidth: col2W - 12, font: regular, size: 7.5,
      color: COLOR_SLATE_TEXT, lineHeight: 9, maxLines: Math.floor((rowH - 6) / 9),
    })

    // Column dividers
    page.drawLine({ start: { x: MARGIN + colBadgeW, y: s }, end: { x: MARGIN + colBadgeW, y: rowY }, thickness: 0.3, color: COLOR_TABLE_BORDER })
    page.drawLine({ start: { x: MARGIN + colBadgeW + col1W, y: s }, end: { x: MARGIN + colBadgeW + col1W, y: rowY }, thickness: 0.3, color: COLOR_TABLE_BORDER })

    rowY = s
  }

  if (steps.length === 0) {
    const emptyMsg = PLACARD_TEXT.noSteps[language]
    const w = regular.widthOfTextAtSize(emptyMsg, 10)
    page.drawText(emptyMsg, {
      x: (PAGE_W - w) / 2, y: dataTop - 30,
      size: 10, font: regular, color: rgb(0.55, 0.55, 0.6),
    })
  }

  // Table outer border
  page.drawRectangle({
    x: MARGIN, y: tableBottom, width: PAGE_W - MARGIN * 2, height: tableH,
    borderColor: COLOR_TABLE_BORDER, borderWidth: 0.5,
    color: undefined,
  })

  // ── 9. Signature bar ─────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: Y_SIG_BOT, width: PAGE_W, height: 18,
    color: rgb(0.97, 0.97, 0.98),
    borderColor: COLOR_TABLE_BORDER, borderWidth: 0.5,
  })
  const sigLabels = PLACARD_TEXT.signature[language]
  const sigColW = PAGE_W / 4
  for (let i = 0; i < 4; i++) {
    const sx = i * sigColW + MARGIN
    page.drawText(sigLabels[i], {
      x: sx, y: Y_SIG_BOT + 5,
      size: 8, font: bold, color: COLOR_NAVY_HEADER,
    })
    if (i < 3) {
      page.drawLine({
        start: { x: (i + 1) * sigColW, y: Y_SIG_BOT },
        end:   { x: (i + 1) * sigColW, y: Y_SIG_BOT + 18 },
        thickness: 0.4, color: COLOR_TABLE_BORDER,
      })
    }
  }

  // ── 10. Draft watermark (ES only, if not reviewed) ───────────────────────
  if (draft) {
    const wmText = 'BORRADOR — NO REVISADO'
    const wmSize = 58
    const wmW = bold.widthOfTextAtSize(wmText, wmSize)
    page.drawText(wmText, {
      x: PAGE_W / 2 - wmW / 2,
      y: PAGE_H / 2 - wmSize / 2,
      size: wmSize, font: bold,
      color: rgb(0.75, 0.1, 0.1),
      opacity: 0.12,
      rotate: degrees(-30),
    })
  }
}

// ── Top-level generators ───────────────────────────────────────────────────
export interface GeneratePlacardArgs {
  equipment: Equipment
  steps:     LotoEnergyStep[]
}

async function addPlacardPages(
  pdfDoc: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  equipment: Equipment,
  steps: LotoEnergyStep[],
) {
  const [equipImage, isoImage] = await Promise.all([
    fetchAndEmbedImage(pdfDoc, equipment.equip_photo_url),
    fetchAndEmbedImage(pdfDoc, equipment.iso_photo_url),
  ])

  // Parse once; reuse on both EN and ES pages.
  const equipAnnotations = parseAnnotations(equipment.annotations)
  const isoAnnotations   = parseAnnotations(equipment.iso_annotations)

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const pageEn = pdfDoc.addPage([PAGE_W, PAGE_H])
  drawPlacardPage(pageEn, fonts, {
    language: 'en', equipment, steps, equipImage, isoImage,
    equipAnnotations, isoAnnotations,
    dateStr, draft: false,
  })

  const pageEs = pdfDoc.addPage([PAGE_W, PAGE_H])
  drawPlacardPage(pageEs, fonts, {
    language: 'es', equipment, steps, equipImage, isoImage,
    equipAnnotations, isoAnnotations,
    dateStr, draft: equipment.spanish_reviewed === false,
  })
}

export async function generatePlacardPdf({ equipment, steps }: GeneratePlacardArgs): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  await addPlacardPages(pdfDoc, { regular, bold }, equipment, steps)
  return pdfDoc.save()
}

export interface BatchItem {
  equipment: Equipment
  steps:     LotoEnergyStep[]
}

export async function generateBatchPlacardPdf(
  items: BatchItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const pdfDoc  = await PDFDocument.create()
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fonts   = { regular, bold }

  for (let i = 0; i < items.length; i++) {
    await addPlacardPages(pdfDoc, fonts, items[i].equipment, items[i].steps)
    onProgress?.(i + 1, items.length)
  }
  return pdfDoc.save()
}
