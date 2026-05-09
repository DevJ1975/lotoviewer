import { describe, it, expect } from 'vitest'
import { inferUploadHint } from '@/app/superadmin/policies/page'

// Pattern-match unit tests for the policies-upload error hint.
// Triggers operators see most often when uploading regulatory PDFs:
// page count, OCR-only scans, encryption, size, format. The hint
// has to be actionable — match the operator's mental model of
// "what do I do next?", not just paraphrase the upstream error.

describe('inferUploadHint', () => {
  it('suggests splitting on a 100-page-limit message', () => {
    const hint = inferUploadHint(
      'The AI service rejected the request: PDF exceeds the 100-page limit.',
    )
    expect(hint).not.toBeNull()
    expect(hint!.toLowerCase()).toContain('split')
  })

  it('matches "too many pages" phrasing too', () => {
    const hint = inferUploadHint('Document has too many pages')
    expect(hint).not.toBeNull()
    expect(hint!.toLowerCase()).toContain('split')
  })

  it('points the operator at OCR for SCAN_NOT_OCRED', () => {
    const hint = inferUploadHint('Reply was SCAN_NOT_OCRED — extraction failed')
    expect(hint).not.toBeNull()
    expect(hint!.toLowerCase()).toContain('ocr')
  })

  it('flags encrypted PDFs', () => {
    const hint = inferUploadHint('Encrypted document — Anthropic refused to read it')
    expect(hint).not.toBeNull()
    expect(hint!.toLowerCase()).toMatch(/encrypt|password/)
  })

  it('flags password-protected PDFs', () => {
    const hint = inferUploadHint('PDF is password protected')
    expect(hint).not.toBeNull()
    expect(hint!.toLowerCase()).toMatch(/encrypt|password/)
  })

  it('suggests splitting on size-limit messages', () => {
    const hint = inferUploadHint('File exceeds the 25MB cap.')
    expect(hint).not.toBeNull()
    expect(hint!.toLowerCase()).toMatch(/split|\.md|\.txt/)
  })

  it('suggests re-export on invalid-PDF messages', () => {
    const hint = inferUploadHint('The AI service rejected the request: invalid pdf format')
    expect(hint).not.toBeNull()
    expect(hint!.toLowerCase()).toMatch(/re-export|plain text/)
  })

  it('returns null on a generic upload failure (no hint better than a wrong hint)', () => {
    expect(inferUploadHint('Network error')).toBeNull()
    expect(inferUploadHint('Failed to load')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(inferUploadHint('PDF EXCEEDS THE 100-PAGE LIMIT')).not.toBeNull()
    expect(inferUploadHint('pdf exceeds the 100-page limit')).not.toBeNull()
  })

  it('does NOT match a generic mention of "page" without a limit context', () => {
    // "page" alone (e.g. an unrelated mention in a network error) shouldn't
    // trigger the splitting hint — that hint is wrong outside the cap context.
    const hint = inferUploadHint('Could not load the page after upload')
    expect(hint).toBeNull()
  })
})
