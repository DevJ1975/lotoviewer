import { describe, it, expect } from 'vitest'
import {
  verifyPNG,
  verifyJPEG,
  verifyPDF,
  verifyWebP,
  verifyPngDataUrl,
} from '@/lib/security/magicBytes'

// Valid magic-byte signatures for each supported format. The
// reference values come from each spec's published header
// definition — see lib/security/magicBytes.ts for citations.
const PNG_HEADER  = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const PDF_HEADER  = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25])
const WEBP_HEADER = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])

describe('magicBytes — positives', () => {
  it('verifyPNG accepts a real PNG header', () => {
    expect(verifyPNG(PNG_HEADER)).toBe(true)
  })
  it('verifyJPEG accepts a real JPEG header', () => {
    expect(verifyJPEG(JPEG_HEADER)).toBe(true)
  })
  it('verifyPDF accepts a real PDF 1.7 header', () => {
    expect(verifyPDF(PDF_HEADER)).toBe(true)
  })
  it('verifyWebP accepts a real WebP RIFF container', () => {
    expect(verifyWebP(WEBP_HEADER)).toBe(true)
  })
})

describe('magicBytes — negatives (the dangerous cases)', () => {
  it('verifyPNG rejects HTML masquerading as a PNG', () => {
    const html = new TextEncoder().encode('<!doctype html><html>...')
    expect(verifyPNG(html)).toBe(false)
  })
  it('verifyPNG rejects empty buffer', () => {
    expect(verifyPNG(new Uint8Array(0))).toBe(false)
  })
  it('verifyPDF rejects EICAR / generic non-PDF', () => {
    const txt = new TextEncoder().encode('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')
    expect(verifyPDF(txt)).toBe(false)
  })
  it('verifyWebP rejects RIFF that is not WebP (e.g. WAV)', () => {
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])
    expect(verifyWebP(wav)).toBe(false)
  })
  it('verifyJPEG rejects truncated 2-byte buffer', () => {
    expect(verifyJPEG(Uint8Array.from([0xff, 0xd8]))).toBe(false)
  })
})

describe('verifyPngDataUrl — full pipeline', () => {
  function pngDataUrl(): string {
    // PNG header + 100 dummy bytes — encodes to a valid base64 chunk.
    const buf = new Uint8Array(120)
    buf.set(PNG_HEADER, 0)
    return 'data:image/png;base64,' + Buffer.from(buf).toString('base64')
  }

  it('returns null for a valid PNG data URL', () => {
    expect(verifyPngDataUrl(pngDataUrl())).toBe(null)
  })
  it('rejects wrong prefix (data:image/jpeg;base64,...)', () => {
    expect(verifyPngDataUrl('data:image/jpeg;base64,iVBOR')).toBe('wrong-prefix')
  })
  it('rejects non-base64 alphabet (URL-safe + padding mismatch)', () => {
    expect(verifyPngDataUrl('data:image/png;base64,abc!def')).toBe('non-base64-alphabet')
  })
  it('rejects valid base64 whose decoded bytes are not a PNG', () => {
    // base64 of "<html>... " — decodes cleanly, alphabet OK, but no PNG
    // magic bytes. THIS is the attack the magic-byte check defends
    // against.
    const evilHtml = Buffer.from('<!doctype html><html><script>x</script></html>').toString('base64')
    expect(verifyPngDataUrl('data:image/png;base64,' + evilHtml))
      .toBe('png-magic-bytes-missing')
  })
  it('rejects empty payload', () => {
    expect(verifyPngDataUrl('data:image/png;base64,')).toBe('non-base64-alphabet')
  })
})
