import { ANALYSIS_LONG_SIDE, assessPhotoQuality, type PhotoQuality } from '@soteria/core/photoQuality'
import { computeTargetDimensions } from '@/lib/imageUtils'

/**
 * Measure a picked photo on the device: downscale it to the size the
 * thresholds were calibrated at, then score it (see @soteria/core/photoQuality).
 *
 * Returns null when the browser cannot decode or draw the image. The check is
 * advisory, so it must never stand between a worker and their upload.
 */
export async function measurePhotoQuality(file: Blob): Promise<PhotoQuality | null> {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, ANALYSIS_LONG_SIDE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // 'high' averages over the many source pixels behind each output pixel on
    // a large downscale; the default can alias, which reads as false detail.
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    return assessPhotoQuality(ctx.getImageData(0, 0, width, height))
  } catch (err) {
    console.warn('[photo] quality check skipped', err)
    return null
  } finally {
    bitmap?.close()
  }
}
