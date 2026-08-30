import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { embedQrCode, sanitizeForWinAnsi } from '@/lib/pdfShared'
import { drawGhsPictogram } from '@/lib/ghsPictograms'
import { drawNfpa704Diamond } from '@/lib/nfpa704'
import { drawDotPlacard } from '@/lib/dotPlacards'
import {
  GHS_PICTOGRAMS,
  type GhsPictogram,
  type GhsSignalWord,
} from '@soteria/core/chemicals'
import { isValidDotHazardClass } from '@soteria/core/hazardSymbols'

// Hazardous-waste label generation. Mirrors lib/chemicalLabels.ts in
// structure (a render entry point, a size catalog, a snapshot input, and
// per-template draw functions) so the two label families stay consistent.
//
// Two templates:
//   hw_container             RCRA 40 CFR 262.32 container marking — the
//                            bold "HAZARDOUS WASTE" header, accumulation
//                            start date, waste-stream name, EPA waste
//                            codes, GHS pictograms, NFPA 704 diamond, DOT
//                            placard + proper shipping name, generator,
//                            and a QR to the live stream record.
//   hw_accumulation_placard  area signage — area name/type, the weekly-
//                            inspection notice, an aggregated GHS/DOT
//                            hazard rollup across the area's streams, and
//                            emergency-contact lines.
//
// Layout is in pdf-lib points (1pt = 1/72"). Container sizes match common
// drum-label stocks; placard sizes match wall-signage sheets.

export type HazardousWasteLabelTemplate = 'hw_container' | 'hw_accumulation_placard'

export interface HwLabelSize {
  /** Stable key used in the API + audit log. */
  key:    string
  /** Human-readable size label, e.g. "4 × 6 in". */
  label:  string
  /** PDF page width / height in points. */
  width:  number
  height: number
}

export const HW_LABEL_SIZES: Record<HazardousWasteLabelTemplate, readonly HwLabelSize[]> = {
  hw_container: [
    { key: '4x6',    label: '4 × 6 in (drum label)',       width: 4 * 72,   height: 6 * 72 },
    { key: '8.5x11', label: '8.5 × 11 in (full sheet)',    width: 8.5 * 72, height: 11 * 72 },
  ],
  hw_accumulation_placard: [
    { key: '8.5x11', label: '8.5 × 11 in (area placard)',  width: 8.5 * 72, height: 11 * 72 },
    { key: '11x17',  label: '11 × 17 in (large placard)',  width: 11 * 72,  height: 17 * 72 },
  ],
}

/**
 * DOT transport details rolled up onto the label. Optional because a
 * stream may be characterized for hazards before its transport profile
 * (proper shipping name / UN / class) is finalized.
 */
export interface HwDotProfile {
  un_number:            string | null
  hazard_class:         string | null
  packing_group:        string | null
  proper_shipping_name: string | null
}

/**
 * Snapshot of the fields that go onto an HW container label at print time.
 * Captured verbatim into hazardous_waste_label_prints.field_snapshot so an
 * inspector can reproduce the label even after the stream row changes.
 */
export interface HwContainerLabelInput {
  stream_id:               string
  stream_name:             string
  /** ISO date the container began accumulating (RCRA start-date marking). */
  accumulation_start_date: string | null
  /** EPA hazardous-waste codes, e.g. ['D001', 'F003']. */
  waste_codes:             string[]
  /** Free-text hazard descriptors from the stream determination. */
  hazards:                 string[]
  ghs_signal_word:         GhsSignalWord | null
  ghs_pictograms:          GhsPictogram[]
  nfpa_health:             number | null
  nfpa_flammability:       number | null
  nfpa_instability:        number | null
  nfpa_special:            string | null
  dot:                     HwDotProfile
  generator_name:          string
  generator_category:      string
  /** Absolute URL the QR code deep-links to (the stream record). */
  qr_url:                  string
  /** Tenant display name for the footer. */
  tenant_name:             string
}

/**
 * Snapshot for an accumulation-area placard. Aggregates the hazards of
 * every active stream in the area into a single rollup so the signage
 * reflects everything stored there.
 */
export interface HwAreaPlacardInput {
  area_id:               string
  area_name:             string
  /** Human-readable area type, e.g. "Satellite accumulation". */
  area_type_label:       string
  /** Weekly-inspection cadence in days (RCRA 262.16/17). */
  inspection_cadence_days: number
  /** Deduped GHS pictograms across the area's active streams. */
  ghs_pictograms:        GhsPictogram[]
  /** Deduped DOT hazard-class ids across the area's active streams. */
  dot_hazard_classes:    string[]
  /** Names of the active streams stored in the area. */
  stream_names:          string[]
  /** Emergency-contact lines, e.g. ['Spill response: 555-0100']. */
  emergency_contacts:    string[]
  qr_url:                string
  tenant_name:           string
}

export type HazardousWasteLabelInput = HwContainerLabelInput | HwAreaPlacardInput

interface RenderArgs {
  template: HazardousWasteLabelTemplate
  sizeKey:  string
  input:    HazardousWasteLabelInput
}

interface RenderResult {
  bytes:    Uint8Array
  filename: string
  byteSize: number
}

/**
 * Render a hazardous-waste label/placard PDF. Throws on unknown
 * template/size; the API route maps that to a 4xx.
 */
export async function renderHazardousWasteLabel(args: RenderArgs): Promise<RenderResult> {
  const sizes = HW_LABEL_SIZES[args.template]
  if (!sizes) throw new Error(`Unknown template: ${args.template}`)
  const size = sizes.find(s => s.key === args.sizeKey)
  if (!size) throw new Error(`Unknown size for ${args.template}: ${args.sizeKey}`)

  const doc  = await PDFDocument.create()
  const page = doc.addPage([size.width, size.height])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let nameForFile: string
  switch (args.template) {
    case 'hw_container':
      await drawContainerLabel(doc, page, font, bold, size, args.input as HwContainerLabelInput)
      nameForFile = (args.input as HwContainerLabelInput).stream_name
      break
    case 'hw_accumulation_placard':
      await drawAccumulationPlacard(doc, page, font, bold, size, args.input as HwAreaPlacardInput)
      nameForFile = (args.input as HwAreaPlacardInput).area_name
      break
  }

  const bytes = await doc.save()
  const safeName = sanitizeForFilename(nameForFile) || 'hazardous-waste'
  return {
    bytes,
    byteSize: bytes.length,
    filename: `${safeName}-${args.template}-${size.key}.pdf`,
  }
}

// ── hw_container — RCRA 262.32 container marking ────────────────────────────
async function drawContainerLabel(
  doc:  PDFDocument,
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  size: HwLabelSize,
  input: HwContainerLabelInput,
): Promise<void> {
  const W = size.width
  const H = size.height
  const margin = Math.min(W, H) * 0.045
  const innerW = W - 2 * margin

  // Cut border so the label trims cleanly on an off-center print.
  page.drawRectangle({
    x: margin / 2, y: margin / 2,
    width: W - margin, height: H - margin,
    borderColor: rgb(0, 0, 0), borderWidth: 1.5,
  })

  // ─ "HAZARDOUS WASTE" header on a solid bar — the words RCRA requires. ─
  const headerH = Math.max(28, H * 0.08)
  page.drawRectangle({
    x: margin, y: H - margin - headerH,
    width: innerW, height: headerH,
    color: rgb(0.85, 0.10, 0.10),
  })
  const headerText = 'HAZARDOUS WASTE'
  const headerSize = fitText(headerText, bold, innerW - 8, pickFont(W, [22, 18, 14]))
  const hw = bold.widthOfTextAtSize(headerText, headerSize)
  page.drawText(headerText, {
    x: margin + (innerW - hw) / 2,
    y: H - margin - headerH + (headerH - headerSize) / 2 + 2,
    font: bold, size: headerSize, color: rgb(1, 1, 1),
  })
  let cy = H - margin - headerH - 10

  // ─ Waste-stream name ───────────────────────────────────────
  const nameSize = pickFont(W, [16, 14, 11])
  for (const line of wrap(input.stream_name, bold, nameSize, innerW).slice(0, 2)) {
    page.drawText(line, { x: margin, y: cy, font: bold, size: nameSize, color: rgb(0, 0, 0) })
    cy -= nameSize * 1.2
  }

  // ─ Accumulation start date + generator category ───────────
  const metaSize = Math.max(8, pickFont(W, [11, 10, 8]))
  const startDate = input.accumulation_start_date ?? '____________'
  page.drawText(sanitizeForWinAnsi(`Accumulation start date: ${startDate}`), {
    x: margin, y: cy, font, size: metaSize, color: rgb(0.1, 0.1, 0.1),
  })
  cy -= metaSize * 1.5
  page.drawText(sanitizeForWinAnsi(`Generator: ${input.generator_name}  (${input.generator_category.toUpperCase()})`), {
    x: margin, y: cy, font, size: metaSize, color: rgb(0.1, 0.1, 0.1), maxWidth: innerW,
  })
  cy -= metaSize * 1.6

  // ─ EPA waste codes ─────────────────────────────────────────
  if (input.waste_codes.length > 0) {
    page.drawText(sanitizeForWinAnsi(`EPA waste codes: ${input.waste_codes.join(', ')}`), {
      x: margin, y: cy, font: bold, size: metaSize, color: rgb(0, 0, 0), maxWidth: innerW,
    })
    cy -= metaSize * 1.6
  }

  // ─ DOT proper shipping name / UN / class ───────────────────
  if (input.dot.proper_shipping_name || input.dot.un_number || input.dot.hazard_class) {
    const parts = [
      input.dot.proper_shipping_name,
      input.dot.un_number ? `UN${input.dot.un_number.replace(/\D/g, '')}` : null,
      input.dot.hazard_class ? `Class ${input.dot.hazard_class}` : null,
      input.dot.packing_group ? `PG ${input.dot.packing_group}` : null,
    ].filter(Boolean) as string[]
    for (const line of wrap(`DOT: ${parts.join(' · ')}`, font, metaSize, innerW).slice(0, 2)) {
      page.drawText(line, { x: margin, y: cy, font, size: metaSize, color: rgb(0.1, 0.1, 0.1) })
      cy -= metaSize * 1.3
    }
    cy -= metaSize * 0.4
  }

  // ─ Symbol row: GHS pictograms, NFPA diamond, DOT placard ───
  const symbolSize = Math.min(innerW / 4, H * 0.14, 64)
  let sx = margin
  const symbolY = cy - symbolSize
  for (const p of input.ghs_pictograms.slice(0, 3)) {
    if (!(GHS_PICTOGRAMS as readonly string[]).includes(p)) continue
    if (sx + symbolSize > W - margin) break
    drawGhsPictogram(page, p as GhsPictogram, { x: sx, y: symbolY, size: symbolSize })
    sx += symbolSize + 6
  }
  // DOT placard to the right of the pictograms when there's room.
  if (input.dot.hazard_class && isValidDotHazardClass(input.dot.hazard_class)
      && sx + symbolSize <= W - margin) {
    drawDotPlacard(page, {
      id: input.dot.hazard_class,
      unNumber: input.dot.un_number,
      packingGroup: input.dot.packing_group,
      x: sx, y: symbolY, size: symbolSize,
    })
  }
  // NFPA diamond in the symbol row's right edge.
  const diamondSize = Math.min(symbolSize * 1.4, innerW * 0.4)
  drawNfpa704Diamond(page, font, bold, {
    cx: W - margin - diamondSize / 2,
    cy: symbolY + symbolSize / 2,
    size: diamondSize,
    health:       input.nfpa_health,
    flammability: input.nfpa_flammability,
    instability:  input.nfpa_instability,
    special:      input.nfpa_special,
  })
  cy = symbolY - 12

  // ─ Hazards list ────────────────────────────────────────────
  if (input.hazards.length > 0 && cy > margin + 90) {
    const hazSize = Math.max(7, pickFont(W, [10, 9, 7]))
    page.drawText('Hazards:', { x: margin, y: cy, font: bold, size: hazSize, color: rgb(0, 0, 0) })
    cy -= hazSize * 1.4
    for (const h of input.hazards.slice(0, 4)) {
      if (cy < margin + 90) break
      for (const line of wrap(`- ${h}`, font, hazSize, innerW).slice(0, 1)) {
        page.drawText(line, { x: margin, y: cy, font, size: hazSize, color: rgb(0.1, 0.1, 0.1) })
        cy -= hazSize * 1.3
      }
    }
  }

  // ─ QR (bottom-right) + footer ──────────────────────────────
  const qrImg = await embedQrCode(doc, input.qr_url, 'hw-container-label')
  if (qrImg) {
    const qrSize = Math.min(W * 0.2, 80)
    page.drawImage(qrImg, { x: W - margin - qrSize, y: margin, width: qrSize, height: qrSize })
  }
  const footerSize = Math.max(6, pickFont(W, [8, 7, 6]))
  page.drawText(
    sanitizeForWinAnsi(`${input.tenant_name} · printed ${new Date().toISOString().slice(0, 10)}`),
    { x: margin, y: margin + 2, font, size: footerSize, color: rgb(0.4, 0.4, 0.4) },
  )
}

// ── hw_accumulation_placard — area signage ──────────────────────────────────
async function drawAccumulationPlacard(
  doc:  PDFDocument,
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  size: HwLabelSize,
  input: HwAreaPlacardInput,
): Promise<void> {
  const W = size.width
  const H = size.height
  const margin = 36
  const innerW = W - 2 * margin

  // Title bar.
  const headerH = 44
  page.drawRectangle({
    x: margin, y: H - margin - headerH,
    width: innerW, height: headerH,
    color: rgb(0.85, 0.10, 0.10),
  })
  page.drawText('HAZARDOUS WASTE ACCUMULATION AREA', {
    x: margin + 10, y: H - margin - headerH + 16,
    font: bold, size: fitText('HAZARDOUS WASTE ACCUMULATION AREA', bold, innerW - 20, 18),
    color: rgb(1, 1, 1),
  })
  let cy = H - margin - headerH - 28

  // Area name + type.
  page.drawText(sanitizeForWinAnsi(input.area_name), {
    x: margin, y: cy, font: bold, size: 24, color: rgb(0, 0, 0), maxWidth: innerW,
  })
  cy -= 28
  page.drawText(sanitizeForWinAnsi(input.area_type_label), {
    x: margin, y: cy, font, size: 14, color: rgb(0.3, 0.3, 0.3),
  })
  cy -= 28

  // Weekly inspection notice.
  page.drawText(sanitizeForWinAnsi(
    `This area is inspected every ${input.inspection_cadence_days} day(s) per 40 CFR 262.16/262.17.`),
    { x: margin, y: cy, font, size: 12, color: rgb(0.1, 0.1, 0.1), maxWidth: innerW })
  cy -= 28

  // Aggregated GHS pictogram row.
  if (input.ghs_pictograms.length > 0) {
    page.drawText('HAZARDS PRESENT', { x: margin, y: cy, font: bold, size: 13, color: rgb(0.13, 0.13, 0.13) })
    cy -= 18
    const pictoSize = Math.min((innerW) / 6, 84)
    let px = margin
    const py = cy - pictoSize
    for (const p of input.ghs_pictograms) {
      if (!(GHS_PICTOGRAMS as readonly string[]).includes(p)) continue
      if (px + pictoSize > W - margin) break
      drawGhsPictogram(page, p as GhsPictogram, { x: px, y: py, size: pictoSize })
      px += pictoSize + 10
    }
    cy = py - 18
  }

  // Aggregated DOT placards.
  const dotClasses = input.dot_hazard_classes.filter(isValidDotHazardClass)
  if (dotClasses.length > 0) {
    page.drawText('DOT TRANSPORT CLASSES', { x: margin, y: cy, font: bold, size: 13, color: rgb(0.13, 0.13, 0.13) })
    cy -= 18
    const placardSize = Math.min((innerW) / 6, 84)
    let px = margin
    const py = cy - placardSize
    for (const id of dotClasses) {
      if (px + placardSize > W - margin) break
      drawDotPlacard(page, { id, x: px, y: py, size: placardSize })
      px += placardSize + 10
    }
    cy = py - 18
  }

  // Active streams stored here.
  if (input.stream_names.length > 0) {
    page.drawText('WASTE STREAMS IN THIS AREA', { x: margin, y: cy, font: bold, size: 13, color: rgb(0.13, 0.13, 0.13) })
    cy -= 18
    for (const name of input.stream_names.slice(0, 8)) {
      if (cy < margin + 120) break
      page.drawText(sanitizeForWinAnsi(`- ${name}`), { x: margin, y: cy, font, size: 11, color: rgb(0.1, 0.1, 0.1), maxWidth: innerW })
      cy -= 16
    }
    cy -= 8
  }

  // Emergency contacts.
  if (input.emergency_contacts.length > 0 && cy > margin + 90) {
    page.drawText('EMERGENCY CONTACTS', { x: margin, y: cy, font: bold, size: 13, color: rgb(0.13, 0.13, 0.13) })
    cy -= 18
    for (const line of input.emergency_contacts.slice(0, 4)) {
      if (cy < margin + 60) break
      page.drawText(sanitizeForWinAnsi(line), { x: margin, y: cy, font, size: 12, color: rgb(0.1, 0.1, 0.1), maxWidth: innerW })
      cy -= 16
    }
  }

  // QR + footer.
  const qrImg = await embedQrCode(doc, input.qr_url, 'hw-area-placard')
  if (qrImg) {
    page.drawImage(qrImg, { x: W - margin - 90, y: 28, width: 90, height: 90 })
  }
  page.drawText(
    sanitizeForWinAnsi(`${input.tenant_name} · printed ${new Date().toISOString().slice(0, 10)}`),
    { x: margin, y: 28, font, size: 9, color: rgb(0.4, 0.4, 0.4) },
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────
function pickFont(width: number, options: number[]): number {
  if (width >= 6 * 72) return options[0]
  if (width >= 3 * 72) return options[1] ?? options[0]
  return options[options.length - 1]
}

// Shrink `base` until `text` fits within `maxWidth`, down to a 6pt floor.
function fitText(text: string, font: PDFFont, maxWidth: number, base: number): number {
  let s = base
  while (s > 6 && font.widthOfTextAtSize(sanitizeForWinAnsi(text), s) > maxWidth) s -= 1
  return s
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = sanitizeForWinAnsi(text)
  if (!safe) return []
  const words = safe.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
    } else {
      if (current) lines.push(current)
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
