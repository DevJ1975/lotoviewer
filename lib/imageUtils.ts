export function computeTargetDimensions(
  width: number,
  height: number,
  maxDim = 2048
): { width: number; height: number } {
  if (width <= maxDim && height <= maxDim) return { width, height }
  const ratio = Math.min(maxDim / width, maxDim / height)
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) }
}

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15, 0.05]

// Feature-detected once — canvas.toBlob('image/webp') silently falls back to
// PNG on browsers without WebP support (old iOS <14, really old Android).
let cachedSupportsWebP: boolean | null = null

export function supportsWebP(): boolean {
  if (cachedSupportsWebP !== null) return cachedSupportsWebP
  try {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    // toDataURL returns the actual encoded type; if WebP isn't supported the
    // browser returns a PNG data URL instead.
    cachedSupportsWebP = c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    cachedSupportsWebP = false
  }
  return cachedSupportsWebP
}

// Test-only — reset the WebP support cache between specs.
export function _resetWebPCache(): void {
  cachedSupportsWebP = null
}

// Every upload is decoded through createImageBitmap with
// imageOrientation: 'from-image' so EXIF orientation is baked into the
// pixel data before the canvas re-encode. Without it, phone photos whose
// bytes are landscape but whose EXIF says "rotate 90°" land sideways in
// storage (canvas drawImage ignores EXIF) and stay sideways in generated
// PDFs (pdf-lib embeds raw bytes and never consults EXIF).
//
// Photos keep their natural, EXIF-corrected orientation — portrait stays
// portrait, landscape stays landscape. The placard/thumbnail slots use
// object-cover so mixed orientations still fill the slot visually. The
// previous forceLandscape behavior rotated portrait photos 90° for slot
// uniformity, but made tall subjects (equipment, panels) appear sideways.
export async function compressImage(file: File, maxBytes = 1_000_000): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const dims = computeTargetDimensions(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = dims.width
    canvas.height = dims.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context not available')
    ctx.drawImage(bitmap, 0, 0, dims.width, dims.height)

    // Prefer WebP — typically 25–35% smaller than JPEG at equivalent quality.
    // Falls back to JPEG on the rare browser that can't encode WebP.
    const useWebP = supportsWebP()
    const mime    = useWebP ? 'image/webp' : 'image/jpeg'
    const ext     = useWebP ? '.webp' : '.jpg'
    const outputName = file.name.replace(/\.[^.]+$/, ext)

    const tryQuality = (q: number) =>
      new Promise<Blob | null>(res => canvas.toBlob(res, mime, q))

    for (const q of QUALITY_STEPS) {
      const blob = await tryQuality(q)
      if (blob && blob.size <= maxBytes) {
        return new File([blob], outputName, { type: mime })
      }
    }
    // Last resort — accept whatever the lowest quality produces.
    const blob = await tryQuality(0.05)
    if (blob) return new File([blob], outputName, { type: mime })
    throw new Error('Could not compress image')
  } finally {
    bitmap.close()
  }
}
