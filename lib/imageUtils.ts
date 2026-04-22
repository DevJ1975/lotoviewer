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

// Landscape normalization — equipment placards and dashboard thumbnails look
// uniform when every stored photo is horizontal. If a photo is portrait we
// rotate it 90° clockwise; if it's already landscape or square we leave it.
// Callers can pass forceLandscape=false to opt out.
export async function compressImage(
  file: File,
  maxBytes = 1_000_000,
  forceLandscape = true,
): Promise<File> {
  // Fast path: caller doesn't care about orientation AND the file is already
  // under the size budget. Skips the load/decode/encode round-trip entirely.
  if (!forceLandscape && file.size <= maxBytes) return file

  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      const isPortrait = img.naturalHeight > img.naturalWidth
      const rotate     = forceLandscape && isPortrait

      // Second fast path: small AND already landscape (or rotation disabled).
      // Avoids re-encoding a perfectly fine photo.
      if (file.size <= maxBytes && !rotate) {
        resolve(file)
        return
      }

      // After rotation the rendered width/height swap.
      const sourceW = rotate ? img.naturalHeight : img.naturalWidth
      const sourceH = rotate ? img.naturalWidth  : img.naturalHeight

      const dims = computeTargetDimensions(sourceW, sourceH)
      const canvas = document.createElement('canvas')
      canvas.width = dims.width
      canvas.height = dims.height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas 2D context not available')); return }
      if (rotate) {
        // Rotate origin → 90° clockwise around (dims.width, 0).
        ctx.translate(dims.width, 0)
        ctx.rotate(Math.PI / 2)
        // After rotation, canvas coordinates become (sourceH, sourceW).
        ctx.drawImage(img, 0, 0, dims.height, dims.width)
      } else {
        ctx.drawImage(img, 0, 0, dims.width, dims.height)
      }

      // Prefer WebP — typically 25–35% smaller than JPEG at equivalent quality.
      // Falls back to JPEG on the rare browser that can't encode WebP.
      const useWebP = supportsWebP()
      const mime    = useWebP ? 'image/webp' : 'image/jpeg'
      const ext     = useWebP ? '.webp' : '.jpg'
      const outputName = file.name.replace(/\.[^.]+$/, ext)

      const tryQuality = (q: number) =>
        new Promise<Blob | null>(res => canvas.toBlob(res, mime, q))

      const compress = async () => {
        // If we're here only for rotation (file already small enough), the
        // first quality step's output is virtually always under maxBytes —
        // the loop is a safety net for the dimension-resize case.
        for (const q of QUALITY_STEPS) {
          const blob = await tryQuality(q)
          if (blob && blob.size <= maxBytes) {
            resolve(new File([blob], outputName, { type: mime }))
            return
          }
        }
        // Last resort — accept whatever the lowest quality produces.
        const blob = await tryQuality(0.05)
        if (blob) resolve(new File([blob], outputName, { type: mime }))
        else reject(new Error('Could not compress image'))
      }

      compress().catch(reject)
    }

    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')) }
    img.src = objectUrl
  })
}
