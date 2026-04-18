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

      const outputName = file.name.replace(/\.[^.]+$/, '.jpg')

      const tryQuality = (q: number) =>
        new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', q))

      const compress = async () => {
        for (const q of QUALITY_STEPS) {
          const blob = await tryQuality(q)
          if (blob && blob.size <= maxBytes) {
            resolve(new File([blob], outputName, { type: 'image/jpeg' }))
            return
          }
        }
        // Last resort — accept whatever the lowest quality produces
        const blob = await tryQuality(0.05)
        if (blob) resolve(new File([blob], outputName, { type: 'image/jpeg' }))
        else reject(new Error('Could not compress image'))
      }

      compress().catch(reject)
    }

    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')) }
    img.src = objectUrl
  })
}
