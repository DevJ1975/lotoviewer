import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  MARGIN, NAVY, PAGE_H, PAGE_W, SLATE, WHITE,
  createDrawCtx, drawDivider, drawKeyValue, drawSectionBar, sanitizeForWinAnsi,
  wrap,
} from '@/lib/pdfShared'
import type { Iso45001ClauseEntry } from '@soteria/core/iso45001'

// ISO 45001 evidence-pack generator. One PDF per clause, listing every
// pinned evidence row in the chosen date window. Auditors love a
// single artifact they can mark up; this is that artifact.

export interface EvidencePackRow {
  id:          string
  source_table: string
  source_id:    string
  captured_at:  string
  notes:        string | null
}

export interface EvidencePackArgs {
  clause: Iso45001ClauseEntry
  rows:   EvidencePackRow[]
  /** ISO yyyy-MM-dd, optional. */
  from:   string
  to:     string
}

export async function generateIso45001EvidencePack(args: EvidencePackArgs): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])
  const ctx  = createDrawCtx({
    doc, page, font, bold,
    legend: `ISO 45001 · Clause ${args.clause.code}`,
  })

  // ── Header ───────────────────────────────────────────────────────
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 64, width: PAGE_W - 2 * MARGIN, height: 64, color: NAVY,
  })
  ctx.page.drawText('ISO 45001 EVIDENCE PACK', {
    x: MARGIN + 14, y: ctx.y - 26, size: 18, font: bold, color: WHITE,
  })
  ctx.page.drawText(sanitizeForWinAnsi(`Clause ${args.clause.code} — ${args.clause.title}`), {
    x: MARGIN + 14, y: ctx.y - 46, size: 10, font: bold, color: WHITE,
  })
  ctx.page.drawText('ISO 45001:2018', {
    x: MARGIN + 14, y: ctx.y - 60, size: 9, font, color: WHITE,
  })
  ctx.y -= 72

  drawKeyValue(ctx, 'Generated', new Date().toLocaleString())
  drawKeyValue(ctx, 'Pinned evidence rows', String(args.rows.length))
  if (args.from || args.to) {
    drawKeyValue(ctx, 'Window', `${args.from || '…'} → ${args.to || '…'}`)
  }
  drawKeyValue(ctx, 'Contributing modules', args.clause.sources.join(', '))
  drawDivider(ctx)

  drawSectionBar(ctx, 'Evidence rows')
  if (args.rows.length === 0) {
    ctx.page.drawText('No evidence pinned for this clause in the selected window.', {
      x: MARGIN, y: ctx.y - 12, size: 10, font, color: SLATE,
    })
    ctx.y -= 16
    return doc.save()
  }

  for (let i = 0; i < args.rows.length; i++) {
    if (ctx.y - 40 < MARGIN + 24) {
      ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
      ctx.pageNo += 1
      ctx.drawFooter(ctx)
      ctx.y = PAGE_H - MARGIN
    }
    const row = args.rows[i]
    const heading = `${String(i + 1).padStart(3, ' ')}. ${row.source_table} / ${row.source_id}`
    ctx.page.drawText(sanitizeForWinAnsi(heading), {
      x: MARGIN, y: ctx.y - 10, size: 9, font: bold, color: NAVY,
    })
    ctx.page.drawText(sanitizeForWinAnsi(`Captured ${new Date(row.captured_at).toLocaleString()}`), {
      x: MARGIN, y: ctx.y - 22, size: 8, font, color: SLATE,
    })
    if (row.notes) {
      const lines = wrap(sanitizeForWinAnsi(row.notes), font, 8, PAGE_W - 2 * MARGIN)
      let y = ctx.y - 34
      for (const line of lines.slice(0, 4)) {
        ctx.page.drawText(line, { x: MARGIN, y, size: 8, font, color: SLATE })
        y -= 10
      }
      ctx.y = y - 4
    } else {
      ctx.y -= 28
    }
    drawDivider(ctx)
  }

  return doc.save()
}
