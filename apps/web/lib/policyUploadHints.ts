// Pattern-match an upstream extraction/ingest error to a concrete next step
// the operator can take. Shared by the superadmin policies page and the
// tenant self-service knowledge page. Keep each hint tight and actionable —
// it must answer "what do I do next?", not paraphrase the error. Returns null
// when nothing matches; the UI then just shows the raw error.
export function inferUploadHint(message: string): string | null {
  const m = message.toLowerCase()
  if (m.includes('page') && (m.includes('limit') || m.includes('exceed') || m.includes('too many'))) {
    return 'Anthropic caps PDFs at 100 pages. Split this document into smaller sections (e.g. by chapter) and upload each separately.'
  }
  if (m.includes('scan') && m.includes('not_ocred')) {
    return 'This PDF looks like scanned images without OCR. Run it through OCR (Acrobat → Recognize Text, or any OCR tool) and re-upload, or paste the text as a .md / .txt file.'
  }
  if (m.includes('encrypt') || m.includes('password')) {
    return 'The PDF appears to be encrypted or password-protected. Save an unprotected copy and re-upload.'
  }
  if (m.includes('size') || m.includes('too large') || m.includes('25mb') || m.includes('exceeds')) {
    return 'The file is over the 25 MB cap. Split the PDF, or upload the text directly as a .md / .txt file (those skip Claude and ingest in seconds).'
  }
  if (m.includes('invalid') && (m.includes('pdf') || m.includes('document'))) {
    return 'The file did not parse as a valid PDF. Re-export from the source and try again, or upload as plain text.'
  }
  return null
}
