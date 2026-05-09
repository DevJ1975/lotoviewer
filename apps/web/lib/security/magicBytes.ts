// Magic-byte verification for uploaded files.
//
// MIME type + extension checks are not enough — both are
// attacker-controlled. The right defence is to read the first
// few bytes of the decoded payload and compare to the file
// format's signature.
//
// References:
//   PNG  — RFC 2083 § 11.2: "89 50 4E 47 0D 0A 1A 0A"
//   JPEG — JFIF/EXIF SOI:    "FF D8 FF"
//   PDF  — PDF 1.x:          "25 50 44 46 2D"  ("%PDF-")
//   WebP — RIFF "WEBP":      "52 49 46 46 .. .. .. .. 57 45 42 50"
//
// Each helper accepts a Buffer, ArrayBuffer, or Uint8Array and
// returns true iff the leading bytes match. Returns false on
// short/empty input rather than throwing — call sites can
// branch cleanly.

type Bytes = Buffer | Uint8Array | ArrayBuffer

function asUint8(input: Bytes): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (input instanceof Uint8Array)  return input
  return new Uint8Array(
    (input as Buffer).buffer,
    (input as Buffer).byteOffset,
    (input as Buffer).byteLength,
  )
}

function startsWith(buf: Uint8Array, signature: number[]): boolean {
  if (buf.length < signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (buf[i] !== signature[i]) return false
  }
  return true
}

const PNG_SIG  = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIG = [0xff, 0xd8, 0xff]
const PDF_SIG  = [0x25, 0x50, 0x44, 0x46, 0x2d]
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46]   // bytes 0-3
const WEBP_SIG = [0x57, 0x45, 0x42, 0x50]   // bytes 8-11

export function verifyPNG(input: Bytes): boolean {
  return startsWith(asUint8(input), PNG_SIG)
}

export function verifyJPEG(input: Bytes): boolean {
  return startsWith(asUint8(input), JPEG_SIG)
}

export function verifyPDF(input: Bytes): boolean {
  return startsWith(asUint8(input), PDF_SIG)
}

export function verifyWebP(input: Bytes): boolean {
  const buf = asUint8(input)
  if (!startsWith(buf, RIFF_SIG)) return false
  if (buf.length < 12) return false
  for (let i = 0; i < 4; i++) {
    if (buf[8 + i] !== WEBP_SIG[i]) return false
  }
  return true
}

/**
 * Decode a `data:image/png;base64,...` URL and verify both the
 * prefix AND the magic bytes of the decoded payload. Used by the
 * toolbox-talks signature endpoint.
 *
 * Returns null on success, or a string describing why the data URL
 * was rejected. Callers should treat the string as opaque (it's
 * intended for logs / error metadata, not for the client).
 */
export function verifyPngDataUrl(dataUrl: string): string | null {
  const PREFIX = 'data:image/png;base64,'
  if (!dataUrl.startsWith(PREFIX)) return 'wrong-prefix'
  const payload = dataUrl.slice(PREFIX.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return 'non-base64-alphabet'
  let buf: Buffer
  try {
    buf = Buffer.from(payload, 'base64')
  } catch {
    return 'base64-decode-failed'
  }
  if (!verifyPNG(buf)) return 'png-magic-bytes-missing'
  return null
}
