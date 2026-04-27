import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
import { hexToRgb01 } from '@/lib/energyCodes'
import { sanitizeForWinAnsi } from '@/lib/pdfPermit'
import {
  HOT_WORK_TYPE_LABELS,
  HOT_WORK_CANCEL_REASON_LABELS,
  type HotWorkPermit,
} from '@/lib/types'
import { hotWorkState } from '@/lib/hotWorkPermitStatus'

// Single-page portrait Letter print for hot-work permits. Layout follows
// the FM Global 7-40 / Cal/OSHA §6777 hot-work permit shape:
//   1. Scope (location, description, work types, time bounds)
//   2. Personnel (PAI, operators, fire watch)
//   3. Pre-work checklist (combustibles, sprinklers, extinguishers, …)
//   4. Cross-references (CS permit, equipment, work order)
//   5. Authorization (signatures)
//   6. Post-work fire watch (timer + closeout)
//
// Reuses sanitizeForWinAnsi() from lib/pdfPermit.ts so the WinAnsi
// edge-case work isn't duplicated.

// ── Page geometry ──────────────────────────────────────────────────────────
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 36

// ── Palette ────────────────────────────────────────────────────────────────
const NAVY    = rgb(...hexToRgb01('#214488'))
const SLATE   = rgb(0.15, 0.18, 0.23)
const MUTED   = rgb(0.45, 0.50, 0.55)
const RULE    = rgb(0.82, 0.85, 0.90)
const WHITE   = rgb(1, 1, 1)
const BLACK   = rgb(0, 0, 0)
const RED     = rgb(...hexToRgb01('#BF1414'))
const AMBER   = rgb(...hexToRgb01('#D97706'))
const EMERALD = rgb(...hexToRgb01('#059669'))
const FAINT   = rgb(0.96, 0.97, 0.99)
// Hot-work band uses a hotter rose so the printed permit is visually
// distinct from the yellow CS permit print. Both are recognizable at
// a glance from across a shop floor.
const ROSE    = rgb(...hexToRgb01('#E11D48'))

// ── Drawing context ────────────────────────────────────────────────────────
interface DrawCtx {
  doc:    PDFDocument
  page:   PDFPage
  font:   PDFFont
  bold:   PDFFont
  y:      number
  pageNo: number
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of sanitizeForWinAnsi(text).split(/\r?\n/)) {
    if (!para.trim()) { out.push(''); continue }
    const words = para.split(/\s+/)
    let cur = ''
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w
      if (font.widthOfTextAtSize(cand, size) <= maxWidth) cur = cand
      else { if (cur) out.push(cur); cur = w }
    }
    if (cur) out.push(cur)
  }
  return out
}

async function embedQrCode(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'Q',
      margin: 1,
      width: 240,
      color: { dark: '#000000', light: '#ffffff' },
    })
    const base64 = dataUrl.split(',')[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return await doc.embedPng(bytes)
  } catch (err) {
    console.error('[pdfHotWorkPermit] QR generation failed', err)
    return null
  }
}

function reserveSpace(ctx: DrawCtx, needed: number): void {
  if (ctx.y - needed < MARGIN + 24) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
    ctx.pageNo += 1
    drawPageFooter(ctx)
    ctx.y = PAGE_H - MARGIN
  }
}

function drawPageFooter(ctx: DrawCtx): void {
  const text = sanitizeForWinAnsi(
    `Page ${ctx.pageNo}  ·  OSHA 29 CFR 1910.252 / NFPA 51B / Cal/OSHA §6777 Hot Work Permit  ·  Generated ${new Date().toLocaleString()}`
  )
  const w = ctx.font.widthOfTextAtSize(text, 7)
  ctx.page.drawText(text, {
    x: PAGE_W - MARGIN - w, y: 18, size: 7, font: ctx.font, color: MUTED,
  })
}

function drawSectionBar(ctx: DrawCtx, title: string): void {
  reserveSpace(ctx, 24)
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 18, width: PAGE_W - 2 * MARGIN, height: 18, color: NAVY,
  })
  ctx.page.drawText(sanitizeForWinAnsi(title.toUpperCase()), {
    x: MARGIN + 8, y: ctx.y - 13, size: 9, font: ctx.bold, color: WHITE,
  })
  ctx.y -= 24
}

function drawKeyValue(ctx: DrawCtx, key: string, value: string, opts?: { wrap?: boolean }): void {
  const labelW = 110
  const valueX = MARGIN + labelW
  const valueMaxW = PAGE_W - MARGIN - valueX
  const lines = opts?.wrap
    ? wrap(value || '—', ctx.font, 9, valueMaxW)
    : [sanitizeForWinAnsi(value || '—')]
  reserveSpace(ctx, 12 * Math.max(1, lines.length) + 4)
  ctx.page.drawText(sanitizeForWinAnsi(key), { x: MARGIN, y: ctx.y - 10, size: 8, font: ctx.bold, color: NAVY })
  for (let i = 0; i < lines.length; i++) {
    ctx.page.drawText(lines[i], {
      x: valueX, y: ctx.y - 10 - i * 11, size: 9, font: ctx.font, color: SLATE,
    })
  }
  ctx.y -= 12 * Math.max(1, lines.length) + 2
}

function drawBullets(ctx: DrawCtx, items: string[]): void {
  if (items.length === 0) {
    drawKeyValue(ctx, '', '— none —')
    return
  }
  const maxW = PAGE_W - 2 * MARGIN - 14
  for (const item of items) {
    const lines = wrap(item, ctx.font, 9, maxW)
    reserveSpace(ctx, 12 * lines.length + 2)
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) {
        ctx.page.drawText('•', { x: MARGIN + 2, y: ctx.y - 10, size: 9, font: ctx.bold, color: NAVY })
      }
      ctx.page.drawText(lines[i], {
        x: MARGIN + 14, y: ctx.y - 10, size: 9, font: ctx.font, color: SLATE,
      })
      ctx.y -= 12
    }
  }
}

function drawDivider(ctx: DrawCtx): void {
  reserveSpace(ctx, 8)
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y - 4 },
    end:   { x: PAGE_W - MARGIN, y: ctx.y - 4 },
    color: RULE, thickness: 0.5,
  })
  ctx.y -= 8
}

// Pre-work checklist: pass/fail/N-A row per question, plus optional
// note column when the answer demands one (alternate protection text,
// extinguisher type). Mirrors the FM Global 7-40 "before work begins"
// checklist visually.
function drawChecklistRow(
  ctx: DrawCtx,
  label: string,
  state: 'yes' | 'no' | 'na' | 'unset',
  note?: string | null,
): void {
  reserveSpace(ctx, 14)
  const stateLabel =
      state === 'yes' ? 'YES'
    : state === 'no'  ? 'NO'
    : state === 'na'  ? 'N/A'
    :                   '—'
  const stateColor =
      state === 'yes' ? EMERALD
    : state === 'no'  ? RED
    : state === 'na'  ? MUTED
    :                   AMBER

  // Label takes the left column; state badge sits in the middle column;
  // note (if any) wraps to the right.
  const stateX = PAGE_W - MARGIN - 200
  const noteX  = PAGE_W - MARGIN - 160
  const noteMaxW = PAGE_W - MARGIN - noteX

  ctx.page.drawText(sanitizeForWinAnsi(label), {
    x: MARGIN + 4, y: ctx.y - 10, size: 8, font: ctx.font, color: SLATE,
  })
  ctx.page.drawRectangle({
    x: stateX, y: ctx.y - 13, width: 32, height: 12, color: stateColor,
  })
  const sw = ctx.bold.widthOfTextAtSize(stateLabel, 7)
  ctx.page.drawText(sanitizeForWinAnsi(stateLabel), {
    x: stateX + (32 - sw) / 2, y: ctx.y - 10, size: 7, font: ctx.bold, color: WHITE,
  })

  if (note) {
    const lines = wrap(note, ctx.font, 7, noteMaxW)
    for (let i = 0; i < lines.length; i++) {
      ctx.page.drawText(lines[i], {
        x: noteX, y: ctx.y - 10 - i * 9, size: 7, font: ctx.font, color: MUTED,
      })
    }
    ctx.y -= 14 + Math.max(0, (lines.length - 1) * 9)
  } else {
    ctx.y -= 14
  }

  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end:   { x: PAGE_W - MARGIN, y: ctx.y },
    color: RULE, thickness: 0.3,
  })
}

function boolToState(v: boolean | null | undefined): 'yes' | 'no' | 'na' | 'unset' {
  if (v === true)  return 'yes'
  if (v === false) return 'no'
  if (v === null)  return 'na'      // explicitly N/A (gas_lines_isolated null)
  return 'unset'
}

// ── Header ─────────────────────────────────────────────────────────────────
function drawHeader(ctx: DrawCtx, permit: HotWorkPermit, qr: PDFImage | null): void {
  // Rose band — visually distinct from the yellow CS permit so a printed
  // permit isn't confused on a shop floor.
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 56, width: PAGE_W - 2 * MARGIN, height: 56, color: ROSE,
  })
  ctx.page.drawText('HOT WORK PERMIT', {
    x: MARGIN + 12, y: ctx.y - 24, size: 16, font: ctx.bold, color: WHITE,
  })
  ctx.page.drawText(sanitizeForWinAnsi('OSHA 29 CFR 1910.252 — NFPA 51B — Cal/OSHA Title 8 §6777'), {
    x: MARGIN + 12, y: ctx.y - 40, size: 9, font: ctx.font, color: WHITE,
  })
  ctx.page.drawText(sanitizeForWinAnsi(permit.serial), {
    x: MARGIN + 12, y: ctx.y - 53, size: 9, font: ctx.bold, color: WHITE,
  })

  // Status badge (right side of band). Maps the 6-state hot-work
  // lifecycle onto a printable label. post_work_watch and
  // post_watch_complete both render as POST-WATCH so the printed
  // copy reads naturally — the live permit page is where the watcher
  // sees the timer.
  const state = hotWorkState(permit, Date.now())
  const status =
      state === 'canceled'             ? 'CANCELED'
    : state === 'expired'              ? 'EXPIRED'
    : state === 'pending_signature'    ? 'PENDING SIGNATURE'
    : state === 'active'               ? 'ACTIVE'
    : state === 'post_work_watch'      ? 'POST-WORK WATCH'
    :                                    'WATCH COMPLETE'
  const statusColor =
      state === 'canceled'             ? SLATE
    : state === 'expired'              ? RED
    : state === 'active'               ? EMERALD
    : state === 'post_work_watch'      ? AMBER
    : state === 'post_watch_complete'  ? EMERALD
    :                                    AMBER
  const statusW = ctx.bold.widthOfTextAtSize(status, 11)
  ctx.page.drawRectangle({
    x: PAGE_W - MARGIN - statusW - 18, y: ctx.y - 32, width: statusW + 14, height: 16, color: statusColor,
  })
  ctx.page.drawText(sanitizeForWinAnsi(status), {
    x: PAGE_W - MARGIN - statusW - 11, y: ctx.y - 28, size: 10, font: ctx.bold, color: WHITE,
  })

  ctx.y -= 60

  if (qr) {
    const QR_SIZE = 80
    ctx.page.drawImage(qr, {
      x: PAGE_W - MARGIN - QR_SIZE,
      y: ctx.y - QR_SIZE,
      width: QR_SIZE, height: QR_SIZE,
    })
    ctx.page.drawText(sanitizeForWinAnsi('Scan for live permit'), {
      x: PAGE_W - MARGIN - QR_SIZE,
      y: ctx.y - QR_SIZE - 10,
      size: 7, font: ctx.font, color: MUTED,
    })
  }

  drawKeyValue(ctx, 'Work location',    permit.work_location, { wrap: true })
  drawKeyValue(ctx, 'Work description', permit.work_description, { wrap: true })
  drawKeyValue(ctx, 'Work types', permit.work_types.length === 0
    ? '—'
    : permit.work_types.map(t => HOT_WORK_TYPE_LABELS[t] ?? t).join(', '))
  drawKeyValue(ctx, 'Permit ID',        permit.id)
  drawKeyValue(ctx, 'Started',          new Date(permit.started_at).toLocaleString())
  drawKeyValue(ctx, 'Expires',          new Date(permit.expires_at).toLocaleString())
  if (permit.pai_signature_at) {
    drawKeyValue(ctx, 'PAI signed',     new Date(permit.pai_signature_at).toLocaleString())
  }
  drawDivider(ctx)
}

// ── Public API ─────────────────────────────────────────────────────────────
export interface GenerateHotWorkPermitArgs {
  permit:     HotWorkPermit
  // Optional URL the QR encodes. Omit and the PDF still renders without
  // a QR (server-side or test fixtures).
  permitUrl?: string
}

export async function generateHotWorkPermitPdf(
  { permit, permitUrl }: GenerateHotWorkPermitArgs,
): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const qr   = permitUrl ? await embedQrCode(doc, permitUrl) : null
  const page = doc.addPage([PAGE_W, PAGE_H])
  const ctx: DrawCtx = { doc, page, font, bold, y: PAGE_H - MARGIN, pageNo: 1 }
  drawPageFooter(ctx)

  drawHeader(ctx, permit, qr)

  // 1. Personnel
  drawSectionBar(ctx, '1. Personnel')
  drawKeyValue(ctx, 'Authorizing individual', `User ${permit.pai_id.slice(0, 8)} (electronic signature)`)
  drawKeyValue(ctx, 'Hot-work operators',  permit.hot_work_operators.length === 0
    ? '—' : permit.hot_work_operators.join(', '), { wrap: true })
  drawKeyValue(ctx, 'Fire watcher(s)',     permit.fire_watch_personnel.length === 0
    ? '—' : permit.fire_watch_personnel.join(', '), { wrap: true })
  if (permit.fire_watch_signature_at) {
    drawKeyValue(ctx, 'Watcher acknowledged',
      `${permit.fire_watch_signature_name ?? '—'} at ${new Date(permit.fire_watch_signature_at).toLocaleString()}`,
      { wrap: true })
  }
  drawDivider(ctx)

  // 2. Pre-work checklist (FM Global 7-40 "before work begins")
  drawSectionBar(ctx, '2. Pre-Work Checklist')
  // Header strip for the YES/NO column
  reserveSpace(ctx, 12)
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 12, width: PAGE_W - 2 * MARGIN, height: 12, color: FAINT,
  })
  ctx.page.drawText(sanitizeForWinAnsi('CHECK'), {
    x: MARGIN + 4, y: ctx.y - 9, size: 7, font: ctx.bold, color: NAVY,
  })
  ctx.page.drawText(sanitizeForWinAnsi('STATUS'), {
    x: PAGE_W - MARGIN - 200, y: ctx.y - 9, size: 7, font: ctx.bold, color: NAVY,
  })
  ctx.page.drawText(sanitizeForWinAnsi('NOTE'), {
    x: PAGE_W - MARGIN - 160, y: ctx.y - 9, size: 7, font: ctx.bold, color: NAVY,
  })
  ctx.y -= 12

  const c = permit.pre_work_checks ?? {}
  drawChecklistRow(ctx, 'Combustibles cleared/shielded within 35 ft', boolToState(c.combustibles_cleared_35ft))
  drawChecklistRow(ctx, 'Floor swept clean',                          boolToState(c.floor_swept))
  drawChecklistRow(ctx, 'Floor openings within 35 ft protected',      boolToState(c.floor_openings_protected))
  drawChecklistRow(ctx, 'Wall openings within 35 ft protected',       boolToState(c.wall_openings_protected))
  drawChecklistRow(ctx, 'Sprinklers operational',                     boolToState(c.sprinklers_operational),
    c.sprinklers_operational === false ? `Alternate: ${c.alternate_protection_if_no_spr ?? '—'}` : null)
  drawChecklistRow(ctx, 'Ventilation adequate',                       boolToState(c.ventilation_adequate))
  drawChecklistRow(ctx, 'Fire extinguisher present',                  boolToState(c.fire_extinguisher_present),
    c.fire_extinguisher_present ? `Type: ${c.fire_extinguisher_type ?? '—'}` : null)
  drawChecklistRow(ctx, 'Curtains/shields in place',                  boolToState(c.curtains_or_shields_in_place))
  drawChecklistRow(ctx, 'Gas lines isolated',                         boolToState(c.gas_lines_isolated ?? null))
  drawChecklistRow(ctx, 'Adjacent areas notified',                    boolToState(c.adjacent_areas_notified))
  drawChecklistRow(ctx, 'Confined-space context',                     boolToState(c.confined_space))
  drawChecklistRow(ctx, 'Elevated work',                              boolToState(c.elevated_work))
  drawChecklistRow(ctx, 'Designated permanent welding area',          boolToState(c.designated_area))
  drawDivider(ctx)

  // 3. Cross-references
  if (permit.associated_cs_permit_id || permit.equipment_id || permit.work_order_ref) {
    drawSectionBar(ctx, '3. Cross-References')
    if (permit.associated_cs_permit_id) {
      drawKeyValue(ctx, 'Confined-space permit', permit.associated_cs_permit_id)
    }
    if (permit.equipment_id) {
      drawKeyValue(ctx, 'LOTO equipment',        permit.equipment_id)
    }
    if (permit.work_order_ref) {
      drawKeyValue(ctx, 'Work order',            permit.work_order_ref)
    }
    drawDivider(ctx)
  }

  // 4. Notes
  if (permit.notes) {
    drawSectionBar(ctx, '4. Notes')
    drawBullets(ctx, [permit.notes])
    drawDivider(ctx)
  }

  // 5. Authorization
  drawSectionBar(ctx, '5. Authorization')
  if (permit.pai_signature_at) {
    drawKeyValue(ctx, 'Authorized by',  `User ${permit.pai_id.slice(0, 8)} (electronic signature)`)
    drawKeyValue(ctx, 'Signed at',      new Date(permit.pai_signature_at).toLocaleString())
  } else {
    drawKeyValue(ctx, 'Status',         'NOT YET SIGNED — work not authorized')
  }
  drawDivider(ctx)

  // 6. Post-work fire watch
  drawSectionBar(ctx, '6. Post-Work Fire Watch')
  drawKeyValue(ctx, 'Watch duration', `${permit.post_watch_minutes} minutes (NFPA 51B §8.7)`)
  if (permit.work_completed_at) {
    const watchEnds = new Date(new Date(permit.work_completed_at).getTime() + permit.post_watch_minutes * 60_000)
    drawKeyValue(ctx, 'Work completed', new Date(permit.work_completed_at).toLocaleString())
    drawKeyValue(ctx, 'Watch ends',     watchEnds.toLocaleString())
  } else {
    drawKeyValue(ctx, 'Work completed', '— pending —')
  }
  drawDivider(ctx)

  // 7. Cancel / closeout block (only when canceled/closed)
  if (permit.canceled_at) {
    drawSectionBar(ctx, '7. Closeout')
    drawKeyValue(ctx, 'Closed at',      new Date(permit.canceled_at).toLocaleString())
    drawKeyValue(ctx, 'Reason',         permit.cancel_reason
      ? (HOT_WORK_CANCEL_REASON_LABELS[permit.cancel_reason] ?? permit.cancel_reason)
      : '—')
    if (permit.cancel_notes) drawKeyValue(ctx, 'Notes', permit.cancel_notes, { wrap: true })
  }

  // Reference unused palette tokens to keep TS happy if future edits drop them.
  void BLACK

  return doc.save()
}
