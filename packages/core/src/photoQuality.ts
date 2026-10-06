// Deterministic quality check for LOTO equipment and isolation-point photos.
//
// Runs on the device at capture time — no network, so it works offline on the
// plant floor — and warns, never blocks, when a photo is too dark or too
// blurry to show the isolation point. The worker can then retake it while
// still standing at the machine, instead of after a reviewer rejects it.
//
// Thresholds were calibrated on 993 accepted EQUIP/ISO placard photos
// (branch claude/placard-photo-cache, October 2026). Neither check fires on any
// of them; both fire on every copy darkened to 20% brightness or blurred by a
// Gaussian of 0.3% of the long side. Two further checks were measured and left
// out on purpose:
//   - blown highlights: its only hits (22) were manufacturer catalogue shots
//     on white backgrounds — every one a false alarm;
//   - minimum resolution: the placard prints each photo about one inch tall,
//     which even the smallest accepted photo (365 px) covers at 300 dpi.

/**
 * Callers downscale to this long side before measuring: it is fast on a phone,
 * and it puts sharpness on one scale whatever the camera's resolution — the
 * thresholds below are only meaningful at this size.
 */
export const ANALYSIS_LONG_SIDE = 512

/** Mean luma (0–255) below which a photo is too dark. The darkest accepted photo measured 51. */
export const MIN_MEAN_LUMA = 45

/**
 * Variance of the Laplacian below which a photo is blurry. The softest
 * accepted photo measured 80 and the median ~1,000; small label text is
 * already unreadable by ~20.
 */
export const MIN_SHARPNESS = 60

export type PhotoQualityIssue = 'too_dark' | 'blurry'

export interface PhotoQuality {
  /** The one thing to fix, or null when the photo looks usable. */
  issue:     PhotoQualityIssue | null
  meanLuma:  number
  /** Null when the image is too small (under 3×3) to measure. */
  sharpness: number | null
}

/** RGBA pixels, row-major — the shape canvas getImageData() returns. */
export interface RgbaImage {
  width:  number
  height: number
  data:   ArrayLike<number>
}

export function assessPhotoQuality(image: RgbaImage): PhotoQuality {
  const luma = toLuma(image)
  const meanLuma = luma.reduce((sum, value) => sum + value, 0) / luma.length
  const sharpness = laplacianVariance(luma, image.width, image.height)

  // Sharpness scales with contrast, and a dark frame has little of either,
  // so blur is judged only once exposure is fine: for a dark photo, more
  // light is the fix to ask for.
  let issue: PhotoQualityIssue | null = null
  if (meanLuma < MIN_MEAN_LUMA) issue = 'too_dark'
  else if (sharpness !== null && sharpness < MIN_SHARPNESS) issue = 'blurry'

  return { issue, meanLuma, sharpness }
}

// Rec. 601 luma, the weighting the calibration used.
function toLuma({ width, height, data }: RgbaImage): Float64Array {
  const luma = new Float64Array(width * height)
  for (let pixel = 0; pixel < luma.length; pixel++) {
    const offset = pixel * 4
    luma[pixel] = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]
  }
  return luma
}

// Variance of the 4-neighbour Laplacian over interior pixels. Edges produce
// large responses and blur flattens them, so a low variance means few edges.
function laplacianVariance(luma: Float64Array, width: number, height: number): number | null {
  if (width < 3 || height < 3) return null
  let count = 0
  let sum = 0
  let sumOfSquares = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const response = luma[i - width] + luma[i + width] + luma[i - 1] + luma[i + 1] - 4 * luma[i]
      count++
      sum += response
      sumOfSquares += response * response
    }
  }
  const mean = sum / count
  return sumOfSquares / count - mean * mean
}
