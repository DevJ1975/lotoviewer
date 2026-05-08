import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { embedQrCode, sanitizeForWinAnsi } from '@/lib/pdfShared'
import { drawGhsPictogram } from '@/lib/ghsPictograms'
import {
  GHS_PICTOGRAMS,
  type GhsPictogram,
  type GhsSignalWord,
} from '@soteria/core/chemicals'

// Chemical-management label generation — Phase C.
//
// Three template families:
//   secondary_container   workplace label per HCS 2012 (1910.1200(f)(6)).
//                         Product name + signal word + pictograms +
//                         hazard statements + PPE.
//   placard               room/cabinet rollup with NFPA 704 diamond +
//                         max quantities. 8.5 × 11.
//   inventory_tag         small "what's in this can" tag with barcode/QR.
//                         For Phase C the QR resolves to the chemical
//                         detail page; once Phase D (inventory items)
//                         lands, it'll resolve to the container record.
//
// Every template lays out in pdf-lib points (1pt = 1/72"). Sizes
// match common label-printer stocks (Brother QL-820 + 8.5×11).

export type LabelTemplate = 'secondary_container' | 'placard' | 'inventory_tag'

export interface LabelSize {
  /** Stable key used in the API + audit log. */
  key:    string
  /** Human-readable size label, e.g. "4 × 6 in". */
  label:  string
  /** PDF page width / height in points. */
  width:  number
  height: number
}

export const LABEL_SIZES: Record<LabelTemplate, readonly LabelSize[]> = {
  secondary_container: [
    { key: '4x6',    label: '4 × 6 in (Brother QL DK-2241)',  width:  4 * 72, height:  6 * 72 },
    { key: '2x4',    label: '2 × 4 in (compact)',             width:  2 * 72, height:  4 * 72 },
    { key: '8.5x11', label: '8.5 × 11 in (full sheet)',       width:  8.5 * 72, height: 11 * 72 },
  ],
  placard: [
    { key: '8.5x11', label: '8.5 × 11 in (cabinet placard)',  width:  8.5 * 72, height: 11 * 72 },
    { key: '11x17',  label: '11 × 17 in (room placard)',      width: 11   * 72, height: 17 * 72 },
  ],
  inventory_tag: [
    { key: '2x1',    label: '2 × 1 in (Avery 5167)',          width:  2 * 72, height: 1 * 72 },
    { key: '4x2',    label: '4 × 2 in (Brother)',             width:  4 * 72, height: 2 * 72 },
  ],
}

/**
 * Snapshot of product fields as they exist at print time. We capture
 * this verbatim into chemical_label_prints.field_snapshot so an
 * auditor can reproduce a label exactly even if the product row has
 * since been edited.
 */
export interface LabelInput {
  product_id:        string
  product_name:      string
  manufacturer:      string | null
  product_code:      string | null
  ghs_signal_word:   GhsSignalWord | null
  ghs_pictograms:    GhsPictogram[]
  hazard_statements: { code: string; text: string }[]
  ppe_required:      string[]
  nfpa_health:       number | null
  nfpa_flammability: number | null
  nfpa_instability:  number | null
  nfpa_special:      string | null
  cas_numbers:       string[]
  storage_class:     string | null
  /** Absolute URL the QR code on the label deep-links to. */
  qr_url:            string
  /** Internal barcode (alphanumeric); rendered on inventory tags. */
  barcode:           string | null
  /** Tenant display name for the print footer. */
  tenant_name:       string
}

interface RenderArgs {
  template: LabelTemplate
  sizeKey:  string
  input:    LabelInput
}

interface RenderResult {
  bytes:     Uint8Array
  filename:  string
  byteSize:  number
  /** The same input echoed back, JSON-safe — to write into the audit log. */
  snapshot:  LabelInput
}

/**
 * Render a chemical label PDF. Throws on unknown template/size or on
 * PDF write failure; the API route maps that to a 4xx/5xx.
 */
export async function renderChemicalLabel(args: RenderArgs): Promise<RenderResult> {
  const sizes = LABEL_SIZES[args.template]
  if (!sizes) throw new Error(`Unknown template: ${args.template}`)
  const size = sizes.find(s => s.key === args.sizeKey)
  if (!size) throw new Error(`Unknown size for ${args.template}: ${args.sizeKey}`)

  const doc  = await PDFDocument.create()
  const page = doc.addPage([size.width, size.height])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  switch (args.template) {
    case 'secondary_container':
      await drawSecondaryContainer(doc, page, font, bold, size, args.input)
      break
    case 'placard':
      await drawPlacard(doc, page, font, bold, size, args.input)
      break
    case 'inventory_tag':
      await drawInventoryTag(doc, page, font, bold, size, args.input)
      break
  }

  const bytes = await doc.save()
  const safeName = sanitizeForFilename(args.input.product_name) || 'chemical'
  return {
    bytes,
    byteSize: bytes.length,
    filename: `${safeName}-${args.template}-${size.key}.pdf`,
    snapshot: args.input,
  }
}

// ── Secondary-container label ──────────────────────────────────────────────
async function drawSecondaryContainer(
  doc:  PDFDocument,
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  size: LabelSize,
  input: LabelInput,
): Promise<void> {
  const W = size.width
  const H = size.height
  const margin = Math.min(W, H) * 0.04
  const innerW = W - 2 * margin

  // Border so the label cuts cleanly even on an off-center print.
  page.drawRectangle({
    x: margin / 2,
    y: margin / 2,
    width:  W - margin,
    height: H - margin,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1.2,
  })

  // ─ Product name (top, bold, wrapped) ────────────────────────
  const nameSize  = pickFont(W, [22, 18, 14])
  const nameLines = wrap(sanitizeForWinAnsi(input.product_name), bold, nameSize, innerW)
    .slice(0, 2)
  let cy = H - margin - nameSize - 4
  for (const line of nameLines) {
    page.drawText(line, { x: margin, y: cy, font: bold, size: nameSize, color: rgb(0, 0, 0) })
    cy -= nameSize * 1.15
  }

  // Manufacturer + code on a sub-line.
  const subParts = [input.manufacturer, input.product_code].filter(Boolean) as string[]
  if (subParts.length > 0) {
    const subSize = Math.max(8, nameSize * 0.55)
    page.drawText(sanitizeForWinAnsi(subParts.join(' · ')), {
      x: margin, y: cy, font, size: subSize, color: rgb(0.3, 0.3, 0.3),
    })
    cy -= subSize * 1.4
  }

  // ─ Signal word ──────────────────────────────────────────────
  if (input.ghs_signal_word) {
    const swSize = pickFont(W, [18, 16, 12])
    const sw = input.ghs_signal_word.toUpperCase()
    const isDanger = input.ghs_signal_word === 'danger'
    const pillW = bold.widthOfTextAtSize(sw, swSize) + 12
    const pillH = swSize + 6
    page.drawRectangle({
      x: margin, y: cy - pillH + swSize - 2,
      width: pillW, height: pillH,
      color: isDanger ? rgb(0.75, 0.10, 0.10) : rgb(0.95, 0.65, 0.10),
    })
    page.drawText(sw, {
      x: margin + 6, y: cy - pillH + swSize + 2,
      font: bold, size: swSize, color: rgb(1, 1, 1),
    })
    cy -= pillH + 4
  }

  // ─ Pictograms ───────────────────────────────────────────────
  const pictoSize = Math.min(innerW / 3, H * 0.18, 60)
  let px = margin
  for (const p of input.ghs_pictograms.slice(0, 6)) {
    if (!(GHS_PICTOGRAMS as readonly string[]).includes(p)) continue
    if (px + pictoSize > W - margin) break
    drawGhsPictogram(page, p as GhsPictogram, { x: px, y: cy - pictoSize, size: pictoSize })
    px += pictoSize + 4
  }
  if (input.ghs_pictograms.length > 0) cy -= pictoSize + 6

  // ─ Hazard statements ────────────────────────────────────────
  const hazSize  = Math.max(7, pickFont(W, [10, 9, 7]))
  const maxHaz   = Math.max(2, Math.floor((cy - margin - 60) / (hazSize * 1.25)))
  const hazLines = input.hazard_statements
    .slice(0, maxHaz)
    .map(h => `${h.code} — ${h.text}`)
  for (const line of hazLines) {
    const wrapped = wrap(sanitizeForWinAnsi(line), font, hazSize, innerW).slice(0, 2)
    for (const w of wrapped) {
      page.drawText(w, { x: margin, y: cy, font, size: hazSize, color: rgb(0, 0, 0) })
      cy -= hazSize * 1.25
    }
  }

  // ─ PPE strip + footer ──────────────────────────────────────
  if (input.ppe_required.length > 0) {
    const ppeSize = Math.max(7, pickFont(W, [9, 8, 7]))
    page.drawText(`PPE: ${sanitizeForWinAnsi(input.ppe_required.join(', '))}`, {
      x: margin, y: margin + 14,
      font: bold, size: ppeSize, color: rgb(0, 0, 0),
      maxWidth: innerW,
    })
  }

  // QR code (bottom-right) — deep-link to digital SDS.
  const qrImg = await embedQrCode(doc, input.qr_url, 'chemical-label')
  if (qrImg) {
    const qrSize = Math.min(W * 0.18, 80)
    page.drawImage(qrImg, {
      x: W - margin - qrSize,
      y: margin,
      width:  qrSize,
      height: qrSize,
    })
  }

  // Footer (tenant + print date).
  const footerSize = Math.max(6, pickFont(W, [8, 7, 6]))
  page.drawText(
    sanitizeForWinAnsi(`${input.tenant_name} · printed ${new Date().toISOString().slice(0, 10)}`),
    { x: margin, y: margin + 2, font, size: footerSize, color: rgb(0.4, 0.4, 0.4) },
  )
}

// ── Placard (cabinet/room rollup) ──────────────────────────────────────────
async function drawPlacard(
  doc:  PDFDocument,
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  size: LabelSize,
  input: LabelInput,
): Promise<void> {
  const W = size.width
  const H = size.height

  // Title
  page.drawText(sanitizeForWinAnsi(input.product_name), {
    x: 36, y: H - 64,
    font: bold, size: 28, color: rgb(0, 0, 0),
    maxWidth: W - 72,
  })
  if (input.manufacturer) {
    page.drawText(sanitizeForWinAnsi(input.manufacturer), {
      x: 36, y: H - 92,
      font, size: 14, color: rgb(0.3, 0.3, 0.3),
    })
  }

  // NFPA 704 diamond (top right). 200pt total, four quadrants.
  drawNfpaDiamond(page, font, bold, {
    cx: W - 36 - 100,
    cy: H - 64 - 100,
    size: 200,
    health:       input.nfpa_health,
    flammability: input.nfpa_flammability,
    instability:  input.nfpa_instability,
    special:      input.nfpa_special,
  })

  // Pictogram strip (full width below title).
  const pictoSize = Math.min((W - 72) / Math.max(input.ghs_pictograms.length || 1, 4), 90)
  let px = 36
  const py = H - 280
  for (const p of input.ghs_pictograms) {
    if (!(GHS_PICTOGRAMS as readonly string[]).includes(p)) continue
    drawGhsPictogram(page, p as GhsPictogram, { x: px, y: py - pictoSize, size: pictoSize })
    px += pictoSize + 12
    if (px + pictoSize > W - 36) break
  }

  // Hazard panel below pictograms.
  let cy = py - pictoSize - 24
  page.drawText('TOP HAZARDS', {
    x: 36, y: cy, font: bold, size: 14, color: rgb(0.13, 0.13, 0.13),
  })
  cy -= 22
  for (const h of input.hazard_statements.slice(0, 8)) {
    const wrapped = wrap(sanitizeForWinAnsi(`${h.code} — ${h.text}`), font, 12, W - 72).slice(0, 2)
    for (const w of wrapped) {
      page.drawText(w, { x: 36, y: cy, font, size: 12, color: rgb(0, 0, 0) })
      cy -= 16
    }
    cy -= 4
  }

  // PPE strip
  if (input.ppe_required.length > 0) {
    cy -= 12
    page.drawText('REQUIRED PPE', {
      x: 36, y: cy, font: bold, size: 14, color: rgb(0.13, 0.13, 0.13),
    })
    cy -= 20
    page.drawText(sanitizeForWinAnsi(input.ppe_required.join(' · ')), {
      x: 36, y: cy, font, size: 12, color: rgb(0, 0, 0),
      maxWidth: W - 72,
    })
  }

  // Footer
  const dateStr = new Date().toISOString().slice(0, 10)
  page.drawText(sanitizeForWinAnsi(`${input.tenant_name} · printed ${dateStr}`), {
    x: 36, y: 28, font, size: 9, color: rgb(0.4, 0.4, 0.4),
  })

  const qrImg = await embedQrCode(doc, input.qr_url, 'chemical-placard')
  if (qrImg) {
    page.drawImage(qrImg, {
      x: W - 36 - 90, y: 28, width: 90, height: 90,
    })
  }
}

// ── Inventory tag (small, barcode-first) ───────────────────────────────────
async function drawInventoryTag(
  doc:  PDFDocument,
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  size: LabelSize,
  input: LabelInput,
): Promise<void> {
  const W = size.width
  const H = size.height
  const margin = 4

  page.drawRectangle({
    x: 1, y: 1, width: W - 2, height: H - 2,
    borderColor: rgb(0, 0, 0), borderWidth: 0.5,
  })

  const nameSize = pickFont(W, [11, 10, 8])
  const wrapped = wrap(sanitizeForWinAnsi(input.product_name), bold, nameSize, W - 2 * margin - H)
    .slice(0, 2)
  let cy = H - margin - nameSize
  for (const line of wrapped) {
    page.drawText(line, { x: margin, y: cy, font: bold, size: nameSize, color: rgb(0, 0, 0) })
    cy -= nameSize * 1.15
  }

  if (input.cas_numbers.length > 0) {
    page.drawText(`CAS ${sanitizeForWinAnsi(input.cas_numbers.join(', '))}`, {
      x: margin, y: cy, font, size: Math.max(6, nameSize * 0.6), color: rgb(0.3, 0.3, 0.3),
    })
    cy -= Math.max(6, nameSize * 0.6) * 1.4
  }

  if (input.barcode) {
    page.drawText(input.barcode, {
      x: margin, y: margin + 2,
      font, size: Math.max(6, nameSize * 0.65), color: rgb(0, 0, 0),
    })
  }

  // QR on the right edge (square, full height).
  const qrImg = await embedQrCode(doc, input.qr_url, 'chemical-tag')
  if (qrImg) {
    const qrSize = H - 4
    page.drawImage(qrImg, {
      x: W - qrSize - 2,
      y: 2,
      width:  qrSize,
      height: qrSize,
    })
  }
}

// ── NFPA 704 diamond ───────────────────────────────────────────────────────
function drawNfpaDiamond(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  args: {
    cx: number; cy: number; size: number
    health: number | null; flammability: number | null
    instability: number | null; special: string | null
  },
): void {
  const half = args.size / 2
  const cx = args.cx
  const cy = args.cy

  // Outer diamond
  page.drawSvgPath(`M 0 -${half} L ${half} 0 L 0 ${half} L -${half} 0 Z`, {
    x: cx, y: cy, color: rgb(0, 0, 0),
  })

  // Quadrants — translate the diamond so each quadrant is a smaller
  // diamond filled with its color, drawn slightly inset from the
  // outer border so the black diamond reads as the frame.
  const inset = args.size * 0.04
  const q = (half - inset) / 2

  // Blue (health) — left
  page.drawSvgPath(`M 0 -${q} L ${q} 0 L 0 ${q} L -${q} 0 Z`, {
    x: cx - q, y: cy, color: rgb(0.0, 0.4, 0.9),
  })
  // Red (flammability) — top
  page.drawSvgPath(`M 0 -${q} L ${q} 0 L 0 ${q} L -${q} 0 Z`, {
    x: cx, y: cy + q, color: rgb(0.85, 0.10, 0.10),
  })
  // Yellow (instability) — right
  page.drawSvgPath(`M 0 -${q} L ${q} 0 L 0 ${q} L -${q} 0 Z`, {
    x: cx + q, y: cy, color: rgb(0.95, 0.85, 0.05),
  })
  // White (special) — bottom
  page.drawSvgPath(`M 0 -${q} L ${q} 0 L 0 ${q} L -${q} 0 Z`, {
    x: cx, y: cy - q, color: rgb(1, 1, 1),
    borderColor: rgb(0, 0, 0), borderWidth: 0.5,
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
  drawCenter(args.health        !== null ? String(args.health)       : '–', rgb(1, 1, 1), -q, 0)
  drawCenter(args.flammability  !== null ? String(args.flammability) : '–', rgb(1, 1, 1),  0, q)
  drawCenter(args.instability   !== null ? String(args.instability)  : '–', rgb(0, 0, 0),  q, 0)
  drawCenter(args.special && args.special.trim() ? args.special.trim().slice(0, 3) : '–', rgb(0, 0, 0), 0, -q)
}

// ── helpers ────────────────────────────────────────────────────────────────
function pickFont(width: number, options: number[]): number {
  // Smaller stocks → smaller text. options sorted largest first.
  if (width >= 6 * 72) return options[0]
  if (width >= 3 * 72) return options[1] ?? options[0]
  return options[options.length - 1]
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return []
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
    } else {
      if (current) lines.push(current)
      // break a long word
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
  return lines
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
}
