import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface CertificateInput {
  learnerName: string
  moduleTitle: string
  organization: string | null
  scorePercent: number
  completedAt: Date
  /** Attempt id: lets an auditor match the paper to the training record. */
  reference: string
}

const NAVY = rgb(0x1d / 255, 0x3e / 255, 0xcf / 255)
const YELLOW = rgb(1, 0xd9 / 255, 0)
const INK = rgb(0.09, 0.11, 0.16)
const MUTED = rgb(0.4, 0.45, 0.53)

/** Landscape Letter completion certificate, generated in the browser. */
export async function buildCertificatePdf(input: CertificateInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${input.moduleTitle} — Certificate of Completion`)
  pdf.setAuthor('Soteria Field · STRIKE')
  const page = pdf.addPage([792, 612])
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const { width, height } = page.getSize()

  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: NAVY })
  page.drawRectangle({ x: 0, y: height - 104, width, height: 8, color: YELLOW })
  page.drawText('STRIKE MICROLEARNING', { x: 48, y: height - 44, size: 11, font: bold, color: YELLOW })
  page.drawText('Certificate of Completion', { x: 48, y: height - 76, size: 26, font: bold, color: rgb(1, 1, 1) })

  const centered = (text: string, y: number, size: number, font = regular, color = INK) => {
    const safe = fitText(text, font, size, width - 120)
    page.drawText(safe, { x: (width - font.widthOfTextAtSize(safe, size)) / 2, y, size, font, color })
  }

  centered('This certifies that', 410, 14, regular, MUTED)
  centered(input.learnerName, 364, 32, bold)
  page.drawRectangle({ x: width / 2 - 160, y: 352, width: 320, height: 1.5, color: YELLOW })
  centered('has completed the training module', 318, 14, regular, MUTED)
  centered(input.moduleTitle, 282, 22, bold, NAVY)
  centered(`Knowledge check passed with ${input.scorePercent}%`, 246, 13, regular)

  const date = input.completedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  page.drawText('COMPLETED', { x: 72, y: 120, size: 9, font: bold, color: MUTED })
  page.drawText(date, { x: 72, y: 102, size: 13, font: regular, color: INK })
  if (input.organization) {
    page.drawText('ORGANIZATION', { x: 300, y: 120, size: 9, font: bold, color: MUTED })
    page.drawText(fitText(input.organization, regular, 13, 220), { x: 300, y: 102, size: 13, font: regular, color: INK })
  }
  page.drawText('RECORD REFERENCE', { x: 560, y: 120, size: 9, font: bold, color: MUTED })
  page.drawText(input.reference.slice(0, 8).toUpperCase(), { x: 560, y: 102, size: 13, font: bold, color: INK })

  page.drawText(
    'This certificate reflects completion of awareness training. Authorization to perform energy control is granted by your employer under its written program.',
    { x: 72, y: 52, size: 8, font: regular, color: MUTED, maxWidth: width - 144, lineHeight: 11 },
  )
  return pdf.save()
}

function fitText(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number): string {
  // Standard PDF fonts are WinAnsi only; drop characters they can't encode.
  let safe = text.replace(/[^\x20-\x7E -ÿ]/g, '')
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe
  while (safe.length > 1 && font.widthOfTextAtSize(`${safe}…`, size) > maxWidth) safe = safe.slice(0, -1)
  return `${safe}…`
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
