import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  PAGE_W, PAGE_H, MARGIN,
  NAVY, SLATE, MUTED, WHITE, RED,
  createDrawCtx, drawSectionBar, drawKeyValue, drawDivider, reserveSpace,
  wrap, sanitizeForWinAnsi, embedQrCode, drawBrandMark,
  type DrawCtx,
} from './pdfShared'
import { GHS_PICTOGRAM_LABEL } from '@soteria/core/chemicals'
import {
  SDS_FACSIMILE_DISCLAIMER,
  SDS_FACSIMILE_EMPTY_SECTION_NOTE,
  type SdsFacsimileModel,
} from '@soteria/core/sdsFacsimile'

// Printable SDS facsimile — renders the 16-section SdsFacsimileModel that
// packages/core/sdsFacsimile.ts assembles from a parsed SDS payload. Mirrors
// the OSHA-permit generators (pdfHotWorkPermit.ts) so the look stays cohesive
// and the WinAnsi/wrap/pagination fixes in pdfShared.ts reach this print too.
//
// WHY the loud banner + footer legend: this is a reformatted, derived copy —
// NOT the manufacturer's original, which remains the OSHA HazCom document of
// record. Both the on-screen viewer and this PDF must say so unmissably; the
// footer legend (per page) and the red header banner are that statement here.

// A red full-width banner with wrapped white text — the "not the original"
// disclaimer at the top of page 1.
function drawDisclaimerBanner(ctx: DrawCtx, text: string): void {
  const innerW = PAGE_W - 2 * MARGIN - 12
  const lines = wrap(text, ctx.bold, 8, innerW)
  const h = 10 + lines.length * 10
  reserveSpace(ctx, h + 6)
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - h, width: PAGE_W - 2 * MARGIN, height: h, color: RED })
  for (let i = 0; i < lines.length; i++) {
    ctx.page.drawText(lines[i], { x: MARGIN + 6, y: ctx.y - 13 - i * 10, size: 8, font: ctx.bold, color: WHITE })
  }
  ctx.y -= h + 8
}

function drawTitle(ctx: DrawCtx, text: string, size: number): void {
  reserveSpace(ctx, size + 6)
  ctx.page.drawText(sanitizeForWinAnsi(text), { x: MARGIN, y: ctx.y - size, size, font: ctx.bold, color: NAVY })
  ctx.y -= size + 6
}

function drawMuted(ctx: DrawCtx, text: string, size = 9): void {
  reserveSpace(ctx, size + 4)
  ctx.page.drawText(sanitizeForWinAnsi(text), { x: MARGIN, y: ctx.y - size, size, font: ctx.font, color: MUTED })
  ctx.y -= size + 4
}

/**
 * Render the SDS facsimile model to a portrait-Letter PDF. `viewUrl`, when
 * given, is encoded as a QR in the header so a printed copy links back to the
 * live record (and, from there, the manufacturer original).
 */
export async function generateSdsFacsimilePdf(args: {
  model:    SdsFacsimileModel
  viewUrl?: string
}): Promise<Uint8Array> {
  const { model, viewUrl } = args
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])

  const ctx = createDrawCtx({
    doc, page, font, bold,
    legend: 'Reformatted SDS facsimile — not the original document of record',
  })

  // Header row: brand mark left, optional QR right.
  drawBrandMark({ page, font, bold, x: MARGIN, y: ctx.y - 18, height: 18, tone: 'dark' })
  if (viewUrl) {
    const qr = await embedQrCode(doc, viewUrl, 'sds-facsimile')
    if (qr) page.drawImage(qr, { x: PAGE_W - MARGIN - 44, y: ctx.y - 44, width: 44, height: 44 })
  }
  ctx.y -= 52

  drawTitle(ctx, model.productName || 'Safety Data Sheet', 16)
  drawMuted(ctx, 'Safety Data Sheet · Reformatted Facsimile')

  // Signal word + pictogram labels (rendered as text — robust across fonts;
  // the viewer shows the pictogram icons).
  const hazardBits: string[] = []
  if (model.signalWord) hazardBits.push(model.signalWord.toUpperCase())
  if (model.pictograms.length > 0) {
    hazardBits.push(model.pictograms.map(c => GHS_PICTOGRAM_LABEL[c]).join(', '))
  }
  if (hazardBits.length > 0) {
    reserveSpace(ctx, 14)
    ctx.page.drawText(sanitizeForWinAnsi(hazardBits.join('  ·  ')), {
      x: MARGIN, y: ctx.y - 10, size: 10, font: bold, color: RED,
    })
    ctx.y -= 16
  }

  drawDisclaimerBanner(ctx, SDS_FACSIMILE_DISCLAIMER.toUpperCase())

  // Provenance — what this copy was derived from.
  const p = model.provenance
  drawKeyValue(ctx, 'Source', p.sourceUrl ?? '—', { wrap: true })
  drawKeyValue(ctx, 'SDS revision', p.revisionDate ?? '—')
  drawKeyValue(ctx, 'Parsed', p.parsedDate ?? '—')
  drawKeyValue(ctx, 'Parsed by', p.parseModel ?? '—')
  drawKeyValue(ctx, 'Confidence', p.parseConfidence ? p.parseConfidence.toUpperCase() : '—')
  drawDivider(ctx)

  // The 16 sections, in order. Empty sections render the not-extracted note.
  for (const section of model.sections) {
    drawSectionBar(ctx, `${section.number}. ${section.title}`)
    if (section.fields.length === 0) {
      reserveSpace(ctx, 14)
      ctx.page.drawText(sanitizeForWinAnsi(SDS_FACSIMILE_EMPTY_SECTION_NOTE), {
        x: MARGIN, y: ctx.y - 10, size: 8, font, color: SLATE,
      })
      ctx.y -= 16
      continue
    }
    for (const f of section.fields) {
      drawKeyValue(ctx, f.label, f.value, { wrap: true })
    }
    ctx.y -= 4
  }

  return doc.save()
}
