import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export async function stampSignature(
  placardUrl: string,
  signatureDataUrl: string,
  reviewerName: string,
  signedAt: string,
): Promise<Uint8Array> {
  const res      = await fetch(placardUrl)
  const pdfBytes = await res.arrayBuffer()
  const pdfDoc   = await PDFDocument.load(pdfBytes)

  const lastPage          = pdfDoc.getPages().at(-1)!
  const { width, height } = lastPage.getSize()
  const font              = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont          = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const sigBase64 = signatureDataUrl.split(',')[1]
  const sigBytes  = Uint8Array.from(atob(sigBase64), c => c.charCodeAt(0))
  const sigImage  = await pdfDoc.embedPng(sigBytes)

  const maxSigWidth = 180
  const scale     = Math.min(maxSigWidth / sigImage.width, 1)
  const sigW      = sigImage.width  * scale
  const sigH      = sigImage.height * scale
  const blockH    = Math.max(sigH + 36, 72)
  const blockY    = 10

  // Ensure there's room — shift content up if the page is full
  void height

  lastPage.drawRectangle({
    x: 20, y: blockY,
    width: width - 40, height: blockH,
    color: rgb(0.97, 0.98, 1),
    borderColor: rgb(0.78, 0.85, 0.92),
    borderWidth: 0.5,
  })
  lastPage.drawLine({
    start: { x: 20,         y: blockY + blockH },
    end:   { x: width - 20, y: blockY + blockH },
    thickness: 1,
    color: rgb(0.68, 0.75, 0.85),
  })

  lastPage.drawImage(sigImage, {
    x: 28, y: blockY + 32,
    width: sigW, height: sigH,
  })

  lastPage.drawText(`Signed by: ${reviewerName}`, {
    x: 28, y: blockY + 19,
    size: 7.5, font,
    color: rgb(0.25, 0.25, 0.25),
  })
  lastPage.drawText(
    `Date: ${new Date(signedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    { x: 28, y: blockY + 9, size: 7.5, font, color: rgb(0.25, 0.25, 0.25) },
  )

  lastPage.drawText('APPROVED', {
    x: width - 118, y: blockY + blockH / 2 - 7,
    size: 13, font: boldFont,
    color: rgb(0.08, 0.48, 0.22),
  })

  return pdfDoc.save()
}

export async function mergePdfs(urls: string[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create()
  for (const url of urls) {
    try {
      const res   = await fetch(url)
      const bytes = await res.arrayBuffer()
      const doc   = await PDFDocument.load(bytes)
      const pages = await merged.copyPages(doc, doc.getPageIndices())
      pages.forEach(p => merged.addPage(p))
    } catch {
      // skip inaccessible PDFs
    }
  }
  return merged.save()
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
