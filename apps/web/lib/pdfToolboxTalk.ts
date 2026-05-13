import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import * as Sentry from '@sentry/nextjs'
import {
  MARGIN,
  NAVY,
  PAGE_H,
  PAGE_W,
  RULE,
  SLATE,
  MUTED,
  FAINT,
  WHITE,
  drawBrandMark,
  sanitizeForWinAnsi,
  wrap,
} from '@/lib/pdfShared'

const BODY_SIZE = 9.5
const LEADING = 12

export interface ToolboxTalkPdfInput {
  tenantName: string | null
  talkUrl: string
  language: 'en' | 'es'
  talk: {
    id: string
    talk_date: string
    title: string
    title_es: string | null
    body_markdown: string
    body_markdown_es: string | null
    key_points: string[]
    key_points_es: string[] | null
    delivery_notes: string | null
    delivery_notes_es: string | null
    generated_by: string | null
    generated_at: string
    ai_model: string | null
  }
  signatures: Array<{
    id: string
    signer_name: string
    employee_id: string | null
    signed_at: string
    inserted_by: string | null
    signature_data: string | null
  }>
}

interface Ctx {
  doc: PDFDocument
  page: PDFPage
  pages: PDFPage[]
  font: PDFFont
  bold: PDFFont
  italic: PDFFont
  y: number
}

export async function renderToolboxTalkPdf(input: ToolboxTalkPdfInput): Promise<Uint8Array> {
  try {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
    const ctx: Ctx = {
      doc,
      page: doc.addPage([PAGE_W, PAGE_H]),
      pages: [],
      font,
      bold,
      italic,
      y: PAGE_H - MARGIN,
    }
    ctx.pages.push(ctx.page)

    const content = selectLanguage(input)
    drawCoverHeader(ctx, input, content)
    drawRecordMetadata(ctx, input)

    drawSectionTitle(ctx, content.labels.keyPoints)
    if (content.keyPoints.length === 0) {
      drawMutedLine(ctx, content.labels.noneRecorded)
    } else {
      drawChecklist(ctx, content.keyPoints)
    }

    drawSectionTitle(ctx, content.labels.talkScript)
    for (const block of markdownToBlocks(content.bodyMarkdown)) {
      if (block.kind === 'heading') {
        drawSubheading(ctx, block.text)
      } else if (block.kind === 'bullet') {
        drawBullet(ctx, block.text)
      } else {
        drawParagraph(ctx, block.text)
      }
    }

    if (content.deliveryNotes) {
      drawSectionTitle(ctx, content.labels.supervisorNotes)
      drawCallout(ctx, content.deliveryNotes)
    }

    drawSectionTitle(ctx, `${content.labels.attendanceRoster} (${input.signatures.length})`)
    await drawRoster(ctx, input.signatures, content.labels)

    finalizeFooters(ctx, input)
    return await doc.save()
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'pdf-toolbox-talk' } })
    throw err
  }
}

function selectLanguage(input: ToolboxTalkPdfInput) {
  const isSpanish = input.language === 'es'
  const title = isSpanish ? input.talk.title_es ?? input.talk.title : input.talk.title
  const bodyMarkdown = isSpanish ? input.talk.body_markdown_es ?? input.talk.body_markdown : input.talk.body_markdown
  const keyPoints = isSpanish && input.talk.key_points_es && input.talk.key_points_es.length > 0
    ? input.talk.key_points_es
    : input.talk.key_points
  const deliveryNotes = isSpanish ? input.talk.delivery_notes_es ?? input.talk.delivery_notes : input.talk.delivery_notes
  return {
    title,
    bodyMarkdown,
    keyPoints,
    deliveryNotes,
    labels: isSpanish ? LABELS_ES : LABELS_EN,
  }
}

function drawCoverHeader(ctx: Ctx, input: ToolboxTalkPdfInput, content: ReturnType<typeof selectLanguage>) {
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - 96, width: PAGE_W, height: 96, color: NAVY })
  drawBrandMark({ page: ctx.page, font: ctx.font, bold: ctx.bold, x: MARGIN, y: PAGE_H - 70, height: 34, tone: 'light' })
  ctx.page.drawText(sanitizeForWinAnsi(content.labels.recordTitle), {
    x: MARGIN,
    y: PAGE_H - 86,
    size: 8,
    font: ctx.bold,
    color: WHITE,
  })

  const dateText = formatDate(input.talk.talk_date, input.language)
  const dateWidth = ctx.bold.widthOfTextAtSize(sanitizeForWinAnsi(dateText), 10)
  ctx.page.drawText(sanitizeForWinAnsi(dateText), {
    x: PAGE_W - MARGIN - dateWidth,
    y: PAGE_H - 50,
    size: 10,
    font: ctx.bold,
    color: WHITE,
  })
  const tenantText = input.tenantName || 'SoteriaField tenant'
  const tenantWidth = ctx.font.widthOfTextAtSize(sanitizeForWinAnsi(tenantText), 8)
  ctx.page.drawText(sanitizeForWinAnsi(tenantText), {
    x: PAGE_W - MARGIN - tenantWidth,
    y: PAGE_H - 64,
    size: 8,
    font: ctx.font,
    color: WHITE,
    opacity: 0.9,
  })
  ctx.y = PAGE_H - 120

  drawWrappedText(ctx, content.title, {
    x: MARGIN,
    width: PAGE_W - 2 * MARGIN,
    size: 20,
    font: ctx.bold,
    color: SLATE,
    leading: 24,
  })
  ctx.y -= 4
}

function drawRecordMetadata(ctx: Ctx, input: ToolboxTalkPdfInput) {
  const rows = [
    ['Talk ID', input.talk.id],
    ['Scheduled date', input.talk.talk_date],
    ['Generated at', formatDateTime(input.talk.generated_at)],
    ['Generated by', input.talk.generated_by || 'cron'],
    ['AI model', input.talk.ai_model || 'not recorded'],
    ['Live record', input.talkUrl],
  ]
  const rowH = 16
  const boxH = rows.length * rowH + 14
  ensureRoom(ctx, boxH)
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - boxH,
    width: PAGE_W - 2 * MARGIN,
    height: boxH,
    color: FAINT,
    borderColor: RULE,
    borderWidth: 0.5,
  })
  let y = ctx.y - 14
  for (const [label, value] of rows) {
    ctx.page.drawText(sanitizeForWinAnsi(label.toUpperCase()), {
      x: MARGIN + 10,
      y,
      size: 6.8,
      font: ctx.bold,
      color: MUTED,
    })
    const lines = wrap(value, ctx.font, 8, PAGE_W - 2 * MARGIN - 138).slice(0, 2)
    for (let i = 0; i < lines.length; i++) {
      ctx.page.drawText(lines[i], {
        x: MARGIN + 122,
        y: y - i * 9,
        size: 8,
        font: ctx.font,
        color: SLATE,
      })
    }
    y -= rowH
  }
  ctx.y -= boxH + 16
}

function drawSectionTitle(ctx: Ctx, title: string) {
  ensureRoom(ctx, 28)
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 20, width: PAGE_W - 2 * MARGIN, height: 20, color: NAVY })
  ctx.page.drawText(sanitizeForWinAnsi(title.toUpperCase()), {
    x: MARGIN + 8,
    y: ctx.y - 14,
    size: 8.5,
    font: ctx.bold,
    color: WHITE,
  })
  ctx.y -= 30
}

function drawSubheading(ctx: Ctx, text: string) {
  ensureRoom(ctx, 20)
  drawWrappedText(ctx, text, {
    x: MARGIN,
    width: PAGE_W - 2 * MARGIN,
    size: 11,
    font: ctx.bold,
    color: NAVY,
    leading: 14,
  })
  ctx.y -= 2
}

function drawParagraph(ctx: Ctx, text: string) {
  drawWrappedText(ctx, text, {
    x: MARGIN,
    width: PAGE_W - 2 * MARGIN,
    size: BODY_SIZE,
    font: ctx.font,
    color: SLATE,
    leading: LEADING,
  })
  ctx.y -= 5
}

function drawBullet(ctx: Ctx, text: string) {
  const lines = wrap(text, ctx.font, BODY_SIZE, PAGE_W - 2 * MARGIN - 18)
  ensureRoom(ctx, Math.max(1, lines.length) * LEADING + 2)
  ctx.page.drawText('•', { x: MARGIN + 4, y: ctx.y - BODY_SIZE, size: BODY_SIZE, font: ctx.bold, color: NAVY })
  for (let i = 0; i < lines.length; i++) {
    ctx.page.drawText(lines[i], {
      x: MARGIN + 18,
      y: ctx.y - BODY_SIZE - i * LEADING,
      size: BODY_SIZE,
      font: ctx.font,
      color: SLATE,
    })
  }
  ctx.y -= Math.max(1, lines.length) * LEADING + 2
}

function drawChecklist(ctx: Ctx, items: string[]) {
  for (const item of items) {
    const lines = wrap(item, ctx.font, 9, PAGE_W - 2 * MARGIN - 28)
    ensureRoom(ctx, Math.max(1, lines.length) * 13 + 6)
    ctx.page.drawCircle({ x: MARGIN + 7, y: ctx.y - 7, size: 5.5, color: rgb(0.9, 0.97, 0.94), borderColor: rgb(0.05, 0.55, 0.34), borderWidth: 1 })
    ctx.page.drawLine({
      start: { x: MARGIN + 4.5, y: ctx.y - 7.5 },
      end: { x: MARGIN + 6.5, y: ctx.y - 10 },
      thickness: 1,
      color: rgb(0.05, 0.55, 0.34),
    })
    ctx.page.drawLine({
      start: { x: MARGIN + 6.5, y: ctx.y - 10 },
      end: { x: MARGIN + 10.5, y: ctx.y - 4.5 },
      thickness: 1,
      color: rgb(0.05, 0.55, 0.34),
    })
    for (let i = 0; i < lines.length; i++) {
      ctx.page.drawText(lines[i], {
        x: MARGIN + 22,
        y: ctx.y - 10 - i * 12,
        size: 9,
        font: ctx.font,
        color: SLATE,
      })
    }
    ctx.y -= Math.max(1, lines.length) * 13 + 3
  }
  ctx.y -= 5
}

function drawCallout(ctx: Ctx, text: string) {
  const lines = wrap(text, ctx.font, 9, PAGE_W - 2 * MARGIN - 22)
  const h = Math.max(34, lines.length * 12 + 18)
  ensureRoom(ctx, h)
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - h,
    width: PAGE_W - 2 * MARGIN,
    height: h,
    color: rgb(1, 0.98, 0.90),
    borderColor: rgb(0.88, 0.50, 0.10),
    borderWidth: 0.8,
  })
  for (let i = 0; i < lines.length; i++) {
    ctx.page.drawText(lines[i], {
      x: MARGIN + 11,
      y: ctx.y - 16 - i * 12,
      size: 9,
      font: ctx.font,
      color: SLATE,
    })
  }
  ctx.y -= h + 14
}

type PdfLabels = Record<keyof typeof LABELS_EN, string>

async function drawRoster(ctx: Ctx, signatures: ToolboxTalkPdfInput['signatures'], labels: PdfLabels) {
  if (signatures.length === 0) {
    drawMutedLine(ctx, labels.noSignatures)
    return
  }

  drawTableHeader(ctx, labels)
  for (const sig of signatures) {
    const signatureImage = await embedSignature(ctx, sig.signature_data)
    const rowH = signatureImage ? 50 : 34
    ensureRoom(ctx, rowH + 8)
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - rowH,
      width: PAGE_W - 2 * MARGIN,
      height: rowH,
      color: WHITE,
      borderColor: RULE,
      borderWidth: 0.4,
    })
    ctx.page.drawText(sanitizeForWinAnsi(sig.signer_name), {
      x: MARGIN + 8,
      y: ctx.y - 13,
      size: 9,
      font: ctx.bold,
      color: SLATE,
    })
    if (sig.employee_id) {
      ctx.page.drawText(sanitizeForWinAnsi(`#${sig.employee_id}`), {
        x: MARGIN + 8,
        y: ctx.y - 26,
        size: 7.5,
        font: ctx.font,
        color: MUTED,
      })
    }
    ctx.page.drawText(sanitizeForWinAnsi(formatDateTime(sig.signed_at)), {
      x: MARGIN + 192,
      y: ctx.y - 13,
      size: 8,
      font: ctx.font,
      color: SLATE,
    })
    if (sig.inserted_by) {
      ctx.page.drawText(sanitizeForWinAnsi(`entered by ${sig.inserted_by.slice(0, 8)}`), {
        x: MARGIN + 192,
        y: ctx.y - 26,
        size: 7,
        font: ctx.font,
        color: MUTED,
      })
    }
    if (signatureImage) {
      const maxW = 150
      const maxH = 36
      const scale = Math.min(maxW / signatureImage.width, maxH / signatureImage.height)
      ctx.page.drawImage(signatureImage, {
        x: PAGE_W - MARGIN - maxW,
        y: ctx.y - rowH + 8,
        width: signatureImage.width * scale,
        height: signatureImage.height * scale,
      })
    } else {
      ctx.page.drawText(sanitizeForWinAnsi(labels.signatureUnavailable), {
        x: PAGE_W - MARGIN - 150,
        y: ctx.y - 18,
        size: 7,
        font: ctx.italic,
        color: MUTED,
      })
    }
    ctx.y -= rowH
  }
}

function drawTableHeader(ctx: Ctx, labels: PdfLabels) {
  ensureRoom(ctx, 22)
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 18, width: PAGE_W - 2 * MARGIN, height: 18, color: FAINT, borderColor: RULE, borderWidth: 0.4 })
  ctx.page.drawText(sanitizeForWinAnsi(labels.worker), { x: MARGIN + 8, y: ctx.y - 12, size: 7, font: ctx.bold, color: MUTED })
  ctx.page.drawText(sanitizeForWinAnsi(labels.signedAt), { x: MARGIN + 192, y: ctx.y - 12, size: 7, font: ctx.bold, color: MUTED })
  ctx.page.drawText(sanitizeForWinAnsi(labels.signature), { x: PAGE_W - MARGIN - 150, y: ctx.y - 12, size: 7, font: ctx.bold, color: MUTED })
  ctx.y -= 18
}

async function embedSignature(ctx: Ctx, dataUrl: string | null): Promise<PDFImage | null> {
  if (!dataUrl) return null
  try {
    const [, payload = ''] = dataUrl.split(',')
    if (!payload) return null
    const bytes = Uint8Array.from(Buffer.from(payload, 'base64'))
    if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
      return await ctx.doc.embedJpg(bytes)
    }
    return await ctx.doc.embedPng(bytes)
  } catch {
    return null
  }
}

function drawMutedLine(ctx: Ctx, text: string) {
  ensureRoom(ctx, 16)
  ctx.page.drawText(sanitizeForWinAnsi(text), { x: MARGIN, y: ctx.y - 10, size: 8, font: ctx.italic, color: MUTED })
  ctx.y -= 18
}

function drawWrappedText(ctx: Ctx, text: string, opts: {
  x: number
  width: number
  size: number
  font: PDFFont
  color: ReturnType<typeof rgb>
  leading: number
}) {
  const lines = wrap(text, opts.font, opts.size, opts.width)
  for (const line of lines) {
    ensureRoom(ctx, opts.leading + 3)
    ctx.page.drawText(line, {
      x: opts.x,
      y: ctx.y - opts.size,
      size: opts.size,
      font: opts.font,
      color: opts.color,
    })
    ctx.y -= opts.leading
  }
}

function ensureRoom(ctx: Ctx, needed: number) {
  if (ctx.y - needed >= MARGIN + 32) return
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
  ctx.pages.push(ctx.page)
  ctx.y = PAGE_H - MARGIN
}

function markdownToBlocks(markdown: string): Array<{ kind: 'heading' | 'paragraph' | 'bullet'; text: string }> {
  const blocks: Array<{ kind: 'heading' | 'paragraph' | 'bullet'; text: string }> = []
  const paragraphs = markdown.split(/\n\s*\n/)
  for (const raw of paragraphs) {
    const lines = raw.split('\n').map(line => cleanMarkdown(line.trim())).filter(Boolean)
    if (lines.length === 0) continue
    if (lines.length === 1 && lines[0].startsWith('### ')) {
      blocks.push({ kind: 'heading', text: lines[0].slice(4).trim() })
      continue
    }
    if (lines.every(line => line.startsWith('- '))) {
      for (const line of lines) blocks.push({ kind: 'bullet', text: line.slice(2).trim() })
      continue
    }
    blocks.push({ kind: 'paragraph', text: lines.join('\n') })
  }
  return blocks
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
}

function finalizeFooters(ctx: Ctx, input: ToolboxTalkPdfInput) {
  const total = ctx.pages.length
  for (let i = 0; i < total; i++) {
    const page = ctx.pages[i]
    const left = sanitizeForWinAnsi(`SoteriaField · Toolbox Talk Record · ${input.talk.talk_date}`)
    const right = sanitizeForWinAnsi(`Page ${i + 1} of ${total}`)
    page.drawLine({ start: { x: MARGIN, y: 28 }, end: { x: PAGE_W - MARGIN, y: 28 }, color: RULE, thickness: 0.5 })
    page.drawText(left, { x: MARGIN, y: 16, size: 7, font: ctx.font, color: MUTED })
    page.drawText(right, { x: PAGE_W - MARGIN - ctx.font.widthOfTextAtSize(right, 7), y: 16, size: 7, font: ctx.font, color: MUTED })
  }
}

function formatDate(yyyymmdd: string, lang: 'en' | 'es'): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'not recorded'
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const LABELS_EN = {
  recordTitle: 'Professional retained record',
  keyPoints: 'Key points',
  talkScript: 'Talk script',
  supervisorNotes: 'Supervisor cue card',
  attendanceRoster: 'Attendance roster',
  noSignatures: 'No signatures have been captured for this talk yet.',
  noneRecorded: 'None recorded.',
  worker: 'Worker',
  signedAt: 'Signed at',
  signature: 'Signature',
  signatureUnavailable: 'Signature image unavailable',
} as const

const LABELS_ES = {
  recordTitle: 'Registro profesional retenido',
  keyPoints: 'Puntos clave',
  talkScript: 'Guion de la plática',
  supervisorNotes: 'Tarjeta para el supervisor',
  attendanceRoster: 'Lista de asistencia',
  noSignatures: 'Todavía no se han capturado firmas para esta plática.',
  noneRecorded: 'No registrado.',
  worker: 'Trabajador',
  signedAt: 'Firmado',
  signature: 'Firma',
  signatureUnavailable: 'Imagen de firma no disponible',
} as const
