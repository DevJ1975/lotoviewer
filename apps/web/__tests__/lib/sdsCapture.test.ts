import { describe, it, expect } from 'vitest'
import { validateCaptureImages, assembleImagesToPdf, MAX_CAPTURE_PAGES } from '@/lib/sdsCapture'
import { verifyPDF } from '@/lib/security/magicBytes'

// Build a base64 string with the given leading magic bytes (+ padding) so the
// validator's magic-byte typing has something real to key on.
function b64WithSig(sig: number[], padTo = 32): string {
  const bytes = new Uint8Array(padTo)
  bytes.set(sig, 0)
  return Buffer.from(bytes).toString('base64')
}
const JPEG = b64WithSig([0xff, 0xd8, 0xff])
const PNG  = b64WithSig([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// A real 1×1 transparent PNG — enough for pdf-lib to embed.
const REAL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

describe('validateCaptureImages', () => {
  it('rejects an empty array', () => {
    expect(validateCaptureImages([])).toMatchObject({ ok: false })
  })

  it('rejects more than the page cap', () => {
    const tooMany = Array.from({ length: MAX_CAPTURE_PAGES + 1 }, () => PNG)
    expect(validateCaptureImages(tooMany)).toMatchObject({ ok: false })
  })

  it('rejects a page that is not a JPEG or PNG', () => {
    const notImage = Buffer.from('this is not an image').toString('base64')
    const r = validateCaptureImages([notImage])
    expect(r.ok).toBe(false)
  })

  it('rejects an undecodable (non-base64) page', () => {
    const r = validateCaptureImages(['%%% not base64 %%%'])
    expect(r.ok).toBe(false)
  })

  it('accepts JPEG + PNG pages and types each', () => {
    const r = validateCaptureImages([JPEG, PNG])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.images.map(i => i.kind)).toEqual(['jpeg', 'png'])
  })

  it('strips a data: URL prefix', () => {
    const r = validateCaptureImages([`data:image/png;base64,${PNG}`])
    expect(r.ok).toBe(true)
  })
})

describe('assembleImagesToPdf', () => {
  it('assembles images into a real PDF (one page per image)', async () => {
    const png = new Uint8Array(Buffer.from(REAL_PNG_B64, 'base64'))
    const pdf = await assembleImagesToPdf([
      { bytes: png, kind: 'png' },
      { bytes: png, kind: 'png' },
    ])
    expect(verifyPDF(pdf)).toBe(true)
    expect(pdf.length).toBeGreaterThan(100)
  })
})
