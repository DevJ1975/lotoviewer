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

// Every upload is decoded through createImageBitmap with
// imageOrientation: 'from-image' so EXIF orientation is baked into the
// pixel data before the canvas re-encode. Without it, phone photos whose
// bytes are landscape but whose EXIF says "rotate 90°" land sideways in
// storage (canvas drawImage ignores EXIF) and stay sideways in generated
// PDFs (pdf-lib embeds raw bytes and never consults EXIF).
//
// Output is always JPEG — pdf-lib's embedJpg cannot decode WebP, so a
// WebP-encoded photo would break placard PDF generation. The ~25-35%
// storage savings aren't worth a broken PDF path.
//
// Photos keep their natural, EXIF-corrected orientation — portrait stays
// portrait, landscape stays landscape. Placard/thumbnail slots use
// object-cover so mixed orientations still fill their containers.
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

    const outputName = file.name.replace(/\.[^.]+$/, '.jpg')
    const tryQuality = (q: number) =>
      new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', q))

    for (const q of QUALITY_STEPS) {
      const blob = await tryQuality(q)
      if (blob && blob.size <= maxBytes) {
        return new File([blob], outputName, { type: 'image/jpeg' })
      }
    }
    // Last resort — accept whatever the lowest quality produces.
    const blob = await tryQuality(0.05)
    if (blob) return new File([blob], outputName, { type: 'image/jpeg' })
    throw new Error('Could not compress image')
  } finally {
    bitmap.close()
  }
}
