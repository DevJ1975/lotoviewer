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

function supportsWebP(): boolean {
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

export async function compressImage(file: File, maxBytes = 1_000_000): Promise<File> {
  if (file.size <= maxBytes) return file

  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      const dims = computeTargetDimensions(img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = dims.width
      canvas.height = dims.height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas 2D context not available')); return }
      ctx.drawImage(img, 0, 0, dims.width, dims.height)

      // Prefer WebP — typically 25–35% smaller than JPEG at equivalent quality.
      // Falls back to JPEG on the rare browser that can't encode WebP.
      const useWebP = supportsWebP()
      const mime    = useWebP ? 'image/webp' : 'image/jpeg'
      const ext     = useWebP ? '.webp' : '.jpg'
      const outputName = file.name.replace(/\.[^.]+$/, ext)

      const tryQuality = (q: number) =>
        new Promise<Blob | null>(res => canvas.toBlob(res, mime, q))

      const compress = async () => {
        for (const q of QUALITY_STEPS) {
          const blob = await tryQuality(q)
          if (blob && blob.size <= maxBytes) {
            resolve(new File([blob], outputName, { type: mime }))
            return
          }
        }
        // Last resort — accept whatever the lowest quality produces
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
