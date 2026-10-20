import { PDFDocument, StandardFonts, rgb, setCharacterSpacing, type PDFFont, type PDFPage } from 'pdf-lib'

// The STRIKE completion certificate, drawn to the Claude Design template
// "STRIKE Certificate of Completion" (landscape Letter, 1056×816 design px).
// Every coordinate below is the template's px value; `pt()` converts at
// 96 px/in so the PDF matches the design 1:1. Runs on the server so the
// record, not the browser, decides what the certificate says.

export type CertificateLocale = 'en' | 'es'

export interface CertificateData {
  locale: CertificateLocale
  learnerName: string
  moduleTitle: string
  organization: string
  completedAt: Date
  /** Attempt id: lets an auditor match the paper to the training record. */
  reference: string
  result: { kind: 'score'; scorePercent: number } | { kind: 'verified'; verifierName: string }
  signatory: { name: string; title: string; issuer: string; signaturePng: Uint8Array } | null
}

const COPY = {
  en: {
    eyebrow: 'STRIKE MICROLEARNING',
    title: 'Certificate of Completion',
    certifies: 'This certifies that',
    completed: 'has successfully completed the training module',
    score: (n: number) => `Knowledge check passed with ${n}%`,
    verified: (name: string) => `Verified in person by ${name} · ADA accommodation`,
    completedLabel: 'COMPLETED',
    organizationLabel: 'ORGANIZATION',
    referenceLabel: 'RECORD REFERENCE',
    disclaimer: 'This certificate records completion of awareness training. Authorization to perform energy control is granted by your employer under its written program.',
    date: (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  },
  es: {
    eyebrow: 'MICROAPRENDIZAJE STRIKE',
    title: 'Certificado de Finalización',
    certifies: 'Se certifica que',
    completed: 'completó satisfactoriamente el módulo de capacitación',
    score: (n: number) => `Evaluación aprobada con ${n}%`,
    verified: (name: string) => `Verificado en persona por ${name} · adaptación ADA`,
    completedLabel: 'FECHA DE FINALIZACIÓN',
    organizationLabel: 'ORGANIZACIÓN',
    referenceLabel: 'REFERENCIA DEL REGISTRO',
    disclaimer: 'Este certificado registra que se completó una capacitación de concientización. La autorización para controlar energía peligrosa la otorga su empleador conforme a su programa escrito.',
    date: (d: Date) => d.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  },
} as const

const PAGE_W = 1056
const PAGE_H = 816
const pt = (px: number) => px * 0.75
/** PDF y for a text baseline at design px `y` from the top. */
const baseline = (y: number) => pt(PAGE_H - y)

const NAVY = rgb(14 / 255, 26 / 255, 46 / 255)
const YELLOW = rgb(1, 217 / 255, 0)
const ACCENT = rgb(29 / 255, 62 / 255, 207 / 255)
const MUTED = rgb(75 / 255, 85 / 255, 99 / 255)
const BODY = rgb(31 / 255, 41 / 255, 55 / 255)
const BAND_TEXT = rgb(201 / 255, 210 / 255, 227 / 255)
const WHITE = rgb(1, 1, 1)

export function certificateFilename(moduleTitle: string): string {
  return `${moduleTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'strike'}-certificate.pdf`
}

export async function buildCertificatePdf(data: CertificateData): Promise<Uint8Array> {
  const copy = COPY[data.locale]
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${data.moduleTitle} — ${copy.title}`)
  pdf.setAuthor(data.signatory?.issuer ?? 'Soteria Field')
  pdf.setSubject(data.learnerName)
  const page = pdf.addPage([pt(PAGE_W), pt(PAGE_H)])
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    serifBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    mono: await pdf.embedFont(StandardFonts.CourierBold),
  }

  // Header band and safety-yellow rule.
  page.drawRectangle({ x: 0, y: baseline(128), width: pt(PAGE_W), height: pt(128), color: NAVY })
  page.drawRectangle({ x: 0, y: baseline(138), width: pt(PAGE_W), height: pt(10), color: YELLOW })
  drawTracked(page, copy.eyebrow, { x: 72, y: 45, size: 14, font: fonts.bold, color: YELLOW, tracking: 0.18 })
  drawText(page, copy.title, { x: 72, y: 94, size: 40, font: fonts.bold, color: WHITE, maxWidth: 640 })
  const issuer = (data.signatory?.issuer ?? 'Soteria Field').toUpperCase()
  drawTracked(page, issuer, { right: PAGE_W - 72, y: 45, size: 14, font: fonts.bold, color: BAND_TEXT, tracking: 0.18 })

  // Centered body.
  drawCentered(page, copy.certifies, { y: 212, size: 18, font: fonts.regular, color: MUTED })
  drawCentered(page, data.learnerName, { y: 277, size: 50, font: fonts.serifBold, color: NAVY })
  page.drawRectangle({ x: pt(PAGE_W / 2 - 190), y: baseline(302.5), width: pt(380), height: pt(3), color: YELLOW })
  drawCentered(page, copy.completed, { y: 345, size: 18, font: fonts.regular, color: MUTED })
  drawCentered(page, data.moduleTitle, { y: 391, size: 30, font: fonts.bold, color: ACCENT })
  const resultLine = data.result.kind === 'score' ? copy.score(data.result.scorePercent) : copy.verified(data.result.verifierName)
  drawCentered(page, resultLine, { y: 430, size: 17, font: fonts.regular, color: BODY })

  // Record details, bottom left.
  const details: [string, string, PDFFont][] = [
    [copy.completedLabel, copy.date(data.completedAt), fonts.regular],
    [copy.organizationLabel, data.organization, fonts.regular],
    [copy.referenceLabel, data.reference.slice(0, 8).toUpperCase(), fonts.mono],
  ]
  details.forEach(([label, value, font], i) => {
    const top = 560 + i * 56
    drawTracked(page, label, { x: 72, y: top + 10, size: 11, font: fonts.bold, color: MUTED, tracking: 0.14 })
    drawText(page, value, { x: 72, y: top + 33.5, size: 18, font, color: NAVY, maxWidth: 400 })
  })

  // Signature block, bottom right.
  if (data.signatory) {
    // A plain copy: pdf-lib type-checks with instanceof, which a Node Buffer from another realm fails.
    const image = await pdf.embedPng(new Uint8Array(data.signatory.signaturePng))
    const scale = Math.min(pt(372) / image.width, pt(96) / image.height)
    const w = image.width * scale
    const h = image.height * scale
    page.drawImage(image, { x: pt(612) + (pt(372) - w) / 2, y: baseline(644) + (pt(96) - h) / 2, width: w, height: h })
  }
  page.drawRectangle({ x: pt(612), y: baseline(651.5), width: pt(372), height: pt(1.5), color: NAVY })
  if (data.signatory) {
    drawText(page, data.signatory.name, { x: 612, y: 672, size: 16, font: fonts.bold, color: NAVY, maxWidth: 372 })
    const role = [data.signatory.title, data.signatory.issuer].filter(Boolean).join(' · ')
    drawText(page, role, { x: 612, y: 694.5, size: 14, font: fonts.regular, color: MUTED, maxWidth: 372 })
  }

  page.drawText(winAnsi(copy.disclaimer), {
    x: pt(72), y: baseline(779), size: pt(12), font: fonts.regular, color: MUTED, maxWidth: pt(912), lineHeight: pt(16.8),
  })
  return pdf.save()
}

interface TextStyle {
  y: number
  size: number
  font: PDFFont
  color: ReturnType<typeof rgb>
}

function drawText(page: PDFPage, text: string, s: TextStyle & { x: number; maxWidth: number }) {
  const { value, size } = fit(text, s.font, s.size, s.maxWidth)
  page.drawText(value, { x: pt(s.x), y: baseline(s.y), size: pt(size), font: s.font, color: s.color })
}

function drawCentered(page: PDFPage, text: string, s: TextStyle) {
  const { value, size } = fit(text, s.font, s.size, 912)
  const width = s.font.widthOfTextAtSize(value, pt(size))
  page.drawText(value, { x: (pt(PAGE_W) - width) / 2, y: baseline(s.y), size: pt(size), font: s.font, color: s.color })
}

/** Letter-spaced caps labels, as the design's `letter-spacing`. */
function drawTracked(page: PDFPage, text: string, s: TextStyle & ({ x: number } | { right: number }) & { tracking: number }) {
  const value = winAnsi(text)
  const spacing = pt(s.size) * s.tracking
  const width = s.font.widthOfTextAtSize(value, pt(s.size)) + spacing * (value.length - 1)
  const x = 'x' in s ? pt(s.x) : pt(s.right) - width
  page.pushOperators(setCharacterSpacing(spacing))
  page.drawText(value, { x, y: baseline(s.y), size: pt(s.size), font: s.font, color: s.color })
  page.pushOperators(setCharacterSpacing(0))
}

/** Shrinks long names and titles to fit, down to 60% size, then truncates. */
function fit(text: string, font: PDFFont, size: number, maxWidthPx: number): { value: string; size: number } {
  let value = winAnsi(text)
  let current = size
  while (font.widthOfTextAtSize(value, pt(current)) > pt(maxWidthPx) && current > size * 0.6) current -= 1
  while (value.length > 1 && font.widthOfTextAtSize(value, pt(current)) > pt(maxWidthPx)) value = `${value.slice(0, -2)}…`
  return { value, size: current }
}

// Standard PDF fonts encode WinAnsi only (Latin-1 plus a few typographic
// marks). Spanish is covered; anything else would make pdf-lib throw.
const WIN_ANSI_EXTRA = new Set(['–', '—', '‘', '’', '“', '”', '•', '…', '€'])
function winAnsi(text: string): string {
  return [...text].filter(ch => {
    const code = ch.codePointAt(0) ?? 0
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)
  }).join('')
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
