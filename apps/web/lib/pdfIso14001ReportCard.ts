import { PDFDocument, StandardFonts, type RGB } from 'pdf-lib'
import {
  AMBER, EMERALD, MARGIN, MUTED, NAVY, PAGE_H, PAGE_W, RED, RULE, SLATE, WHITE,
  createDrawCtx, drawSectionBar, reserveSpace, sanitizeForWinAnsi, wrap,
  type DrawCtx,
} from '@/lib/pdfShared'
import type {
  ClauseAssessment, ClauseVerdict, Iso14001ReportCard,
} from '@soteria/core/iso14001Readiness'

// ISO 14001 audit-readiness report card, as a single artifact an EHS
// manager can take into a management review or hand to a consultant.
//
// The wording here matters as much as the layout: this document says
// "audit readiness" and "evidence coverage", never "compliant". A PDF
// escapes the app — it gets emailed, printed, and forwarded to
// certification bodies — so it carries its own disclaimer rather than
// relying on UI context the reader will not have.

const VERDICT_LABEL: Record<ClauseVerdict, string> = {
  conforming:     'Evidenced',
  attention:      'Needs attention',
  gap:            'No evidence',
  not_applicable: 'Not applicable',
}

const VERDICT_COLOR: Record<ClauseVerdict, RGB> = {
  conforming:     EMERALD,
  attention:      AMBER,
  gap:            RED,
  not_applicable: MUTED,
}

const BAND_HEADING: Record<Iso14001ReportCard['band'], string> = {
  ready:           'READY FOR A CERTIFICATION AUDIT',
  ready_with_gaps: 'READY WITH GAPS',
  not_ready:       'NOT READY',
}

export interface ReportCardPdfArgs {
  card:       Iso14001ReportCard
  tenantName: string
  /** ISO timestamp the card was computed at. Passed in rather than read
   *  from the clock so the PDF and the screen agree. */
  generatedAt: string
}

export async function generateIso14001ReportCard(args: ReportCardPdfArgs): Promise<Uint8Array> {
  const { card, tenantName, generatedAt } = args

  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])
  const ctx  = createDrawCtx({
    doc, page, font, bold,
    legend: 'ISO 14001:2015 · Audit readiness',
  })

  // ── Header band ──────────────────────────────────────────────────
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 64, width: PAGE_W - 2 * MARGIN, height: 64, color: NAVY,
  })
  ctx.page.drawText('ISO 14001:2015 AUDIT READINESS', {
    x: MARGIN + 14, y: ctx.y - 26, size: 16, font: bold, color: WHITE,
  })
  ctx.page.drawText(sanitizeForWinAnsi(tenantName), {
    x: MARGIN + 14, y: ctx.y - 44, size: 10, font, color: WHITE,
  })
  // Labelled "Assessed", not "Generated": the footer already stamps
  // render time, and the two differ when a user leaves the page open
  // before exporting. This is the one that describes the data.
  const stamp = sanitizeForWinAnsi(`Assessed ${new Date(generatedAt).toLocaleString()}`)
  ctx.page.drawText(stamp, {
    x: PAGE_W - MARGIN - 14 - font.widthOfTextAtSize(stamp, 8), y: ctx.y - 44, size: 8, font, color: WHITE,
  })
  ctx.y -= 78

  // ── Verdict ──────────────────────────────────────────────────────
  const bandColor = card.band === 'ready' ? EMERALD : card.band === 'ready_with_gaps' ? AMBER : RED
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 44, width: PAGE_W - 2 * MARGIN, height: 44,
    color: WHITE, borderColor: bandColor, borderWidth: 2,
  })
  ctx.page.drawText(BAND_HEADING[card.band], {
    x: MARGIN + 12, y: ctx.y - 20, size: 12, font: bold, color: bandColor,
  })
  for (const [i, line] of wrap(card.headline, font, 8, PAGE_W - 2 * MARGIN - 24).slice(0, 2).entries()) {
    ctx.page.drawText(line, { x: MARGIN + 12, y: ctx.y - 33 - i * 9, size: 8, font, color: SLATE })
  }
  ctx.y -= 56

  // ── Coverage + counts ────────────────────────────────────────────
  drawSectionBar(ctx, 'Evidence coverage')
  const applicable = card.clauses.length - card.counts.not_applicable
  ctx.page.drawText(`${card.coverage}%`, {
    x: MARGIN, y: ctx.y - 22, size: 26, font: bold, color: NAVY,
  })
  ctx.page.drawText(
    sanitizeForWinAnsi(`of ${applicable} applicable clauses carry current evidence`),
    { x: MARGIN + 74, y: ctx.y - 14, size: 9, font, color: SLATE },
  )
  const tally = `${card.counts.conforming} evidenced  ·  ${card.counts.attention} need attention  ·  `
    + `${card.counts.gap} no evidence  ·  ${card.counts.not_applicable} n/a`
  ctx.page.drawText(sanitizeForWinAnsi(tally), {
    x: MARGIN + 74, y: ctx.y - 26, size: 8, font, color: MUTED,
  })
  ctx.y -= 40

  // Coverage is not a conformity claim, and this document will be read
  // far from the UI that says so. State it on the artifact itself.
  for (const [i, line] of wrap(
    'Evidence coverage measures whether records exist and are current in this platform. '
    + 'It is not a statement of conformity — only an accredited certification body can determine that. '
    + 'Blocking findings below fail an audit regardless of coverage.',
    font, 7.5, PAGE_W - 2 * MARGIN,
  ).entries()) {
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y - i * 9, size: 7.5, font, color: MUTED })
  }
  ctx.y -= 34

  // ── Blocking findings ────────────────────────────────────────────
  if (card.blockers.length > 0) {
    drawSectionBar(ctx, 'Blocking findings')
    for (const b of card.blockers) {
      reserveSpace(ctx, 24)
      ctx.page.drawText(sanitizeForWinAnsi(`${b.code}  ${b.title}`), {
        x: MARGIN, y: ctx.y - 10, size: 9, font: bold, color: RED,
      })
      for (const [i, line] of wrap(b.reason, font, 8, PAGE_W - 2 * MARGIN - 12).entries()) {
        ctx.page.drawText(line, { x: MARGIN + 12, y: ctx.y - 21 - i * 9, size: 8, font, color: SLATE })
      }
      ctx.y -= 24
    }
    ctx.y -= 6
  }

  // ── Clause table ─────────────────────────────────────────────────
  drawSectionBar(ctx, 'Clause-by-clause')
  for (const c of card.clauses) {
    drawClauseRow(ctx, c)
  }

  return doc.save()
}

// Two lines per clause rather than four columns. Clause titles run to
// 45+ characters ("Monitoring, measurement, analysis and evaluation —
// general"), which no column narrow enough to leave room for the reason
// can hold; the first attempt at a four-column row overlapped its own
// text. Title and status share the top line, reason gets the full width
// underneath.
const TEXT_X = MARGIN + 34   // left edge of title and reason
const STATUS_W = 82          // reserved on the right of the title line

function drawClauseRow(ctx: DrawCtx, c: ClauseAssessment): void {
  const titleMaxW  = PAGE_W - MARGIN - STATUS_W - TEXT_X - 8
  const reasonMaxW = PAGE_W - MARGIN - TEXT_X
  const reason = wrap(c.reason, ctx.font, 8, reasonMaxW)
  const rowH = 12 + reason.length * 9 + 5
  reserveSpace(ctx, rowH)

  const color = VERDICT_COLOR[c.verdict]
  const top   = ctx.y

  // Colour rail plus a text label: the colour is the scannable signal,
  // the label carries it in greyscale print and for low colour vision.
  ctx.page.drawRectangle({ x: MARGIN, y: top - rowH + 5, width: 3, height: rowH - 5, color })

  ctx.page.drawText(sanitizeForWinAnsi(c.code), {
    x: MARGIN + 8, y: top - 9, size: 8, font: ctx.bold, color: SLATE,
  })

  // Titles come from our own clause map, so truncation is a safety net
  // rather than an expected path.
  let title = sanitizeForWinAnsi(c.title)
  while (title.length > 1 && ctx.bold.widthOfTextAtSize(title, 8) > titleMaxW) {
    title = title.slice(0, -2) + '…'
  }
  ctx.page.drawText(title, {
    x: TEXT_X, y: top - 9, size: 8, font: ctx.bold, color: SLATE,
  })

  const label = VERDICT_LABEL[c.verdict]
  ctx.page.drawText(label, {
    x: PAGE_W - MARGIN - ctx.bold.widthOfTextAtSize(label, 7.5),
    y: top - 9, size: 7.5, font: ctx.bold, color,
  })

  for (const [i, line] of reason.entries()) {
    ctx.page.drawText(line, {
      x: TEXT_X, y: top - 20 - i * 9, size: 8, font: ctx.font, color: MUTED,
    })
  }

  ctx.y = top - rowH
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y + 2 }, end: { x: PAGE_W - MARGIN, y: ctx.y + 2 },
    thickness: 0.4, color: RULE,
  })
}
