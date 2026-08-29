import { PDFDocument } from 'pdf-lib'
import { verifyJPEG, verifyPNG } from '@/lib/security/magicBytes'

// Paper-SDS capture: validate photographed page images and assemble them into
// a single PDF so the document of record is a real archived sheet (not loose
// JPEGs) that the existing parse → review pipeline can consume.

export const MAX_CAPTURE_PAGES = 8
export const MAX_IMAGE_BYTES   = 10_000_000   // 10 MB per page
export const MAX_TOTAL_BYTES   = 40_000_000   // 40 MB across the capture

export interface CaptureImage { bytes: Uint8Array; kind: 'jpeg' | 'png' }

export type ValidateCaptureResult =
  | { ok: true; images: CaptureImage[] }
  | { ok: false; error: string }

// Decode a base64 string (optionally a data: URL) to bytes. Returns null on a
// non-base64 alphabet so the caller can reject it as a boundary violation.
function decodeBase64(input: string): Uint8Array | null {
  const comma = input.indexOf(',')
  const b64 = input.startsWith('data:') && comma >= 0 ? input.slice(comma + 1) : input
  const trimmed = b64.trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null
  try { return new Uint8Array(Buffer.from(trimmed, 'base64')) } catch { return null }
}

/**
 * Validate an array of base64 page images. Enforces count, per-image + total
 * size caps, and magic-byte image typing (JPEG/PNG only — pdf-lib embeds those
 * natively; a camera canvas produces them).
 */
export function validateCaptureImages(raw: unknown): ValidateCaptureResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Provide at least one page image.' }
  }
  if (raw.length > MAX_CAPTURE_PAGES) {
    return { ok: false, error: `Too many pages (max ${MAX_CAPTURE_PAGES}).` }
  }

  const images: CaptureImage[] = []
  let total = 0
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (typeof item !== 'string') return { ok: false, error: `Page ${i + 1} is not a valid image.` }
    const bytes = decodeBase64(item)
    if (!bytes || bytes.length === 0) return { ok: false, error: `Page ${i + 1} could not be decoded.` }
    if (bytes.length > MAX_IMAGE_BYTES) {
      return { ok: false, error: `Page ${i + 1} is too large (max ${MAX_IMAGE_BYTES / 1_000_000} MB).` }
    }
    total += bytes.length
    if (total > MAX_TOTAL_BYTES) return { ok: false, error: 'Total capture size exceeds the limit.' }

    const kind = verifyJPEG(bytes) ? 'jpeg' : verifyPNG(bytes) ? 'png' : null
    if (!kind) return { ok: false, error: `Page ${i + 1} must be a JPEG or PNG photo.` }
    images.push({ bytes, kind })
  }
  return { ok: true, images }
}

/** Assemble validated page images into a one-image-per-page PDF. */
export async function assembleImagesToPdf(images: CaptureImage[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (const img of images) {
    const embedded = img.kind === 'jpeg' ? await pdf.embedJpg(img.bytes) : await pdf.embedPng(img.bytes)
    const page = pdf.addPage([embedded.width, embedded.height])
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })
  }
  return pdf.save()
}
