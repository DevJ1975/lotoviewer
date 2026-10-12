import { describe, it, expect } from 'vitest'
import {
  assessPhotoQuality, MIN_MEAN_LUMA, MIN_SHARPNESS, type RgbaImage,
} from '../photoQuality'

// Synthetic images with known properties. The thresholds themselves were
// calibrated on 993 real placard photos (see the module header); these tests
// pin the scoring logic around them.

function image(width: number, height: number, lumaAt: (x: number, y: number) => number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = lumaAt(x, y)
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

/** Sharp, mid-grey edges: 8-px squares alternating between two levels. */
const checkerboard = (low: number, high: number) =>
  image(64, 64, (x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? high : low))

describe('assessPhotoQuality', () => {
  it('passes a well-lit, sharp image', () => {
    const q = assessPhotoQuality(checkerboard(60, 200))
    expect(q.issue).toBeNull()
    expect(q.meanLuma).toBeCloseTo(130, 5)
    expect(q.sharpness!).toBeGreaterThan(MIN_SHARPNESS)
  })

  it('flags a dark image as too dark', () => {
    const q = assessPhotoQuality(checkerboard(5, 60))
    expect(q.meanLuma).toBeLessThan(MIN_MEAN_LUMA)
    expect(q.issue).toBe('too_dark')
  })

  it('reports too dark, not blurry, when a photo is both', () => {
    // A dark frame has little contrast, so its sharpness reads low too;
    // more light is the one fix worth asking for.
    const q = assessPhotoQuality(image(32, 32, () => 20))
    expect(q.sharpness).toBe(0)
    expect(q.issue).toBe('too_dark')
  })

  it('flags a featureless, well-lit image as blurry', () => {
    const q = assessPhotoQuality(image(32, 32, () => 128))
    expect(q.sharpness).toBe(0)
    expect(q.issue).toBe('blurry')
  })

  it('flags a soft gradient as blurry even though it has some detail', () => {
    // A gentle ramp has a near-zero Laplacian: no edges a reader could use.
    const q = assessPhotoQuality(image(64, 64, x => 80 + x))
    expect(q.sharpness!).toBeLessThan(MIN_SHARPNESS)
    expect(q.issue).toBe('blurry')
  })

  it('does not flag an image exactly at the brightness threshold', () => {
    expect(assessPhotoQuality(checkerboard(MIN_MEAN_LUMA - 20, MIN_MEAN_LUMA + 20)).issue).toBeNull()
  })

  it('weights channels by Rec. 601 luma, so green reads brighter than blue', () => {
    const solid = (r: number, g: number, b: number): RgbaImage => ({
      width: 3, height: 3, data: new Uint8ClampedArray(Array.from({ length: 9 }, () => [r, g, b, 255]).flat()),
    })
    expect(assessPhotoQuality(solid(0, 255, 0)).meanLuma).toBeCloseTo(0.587 * 255, 6)
    expect(assessPhotoQuality(solid(0, 0, 255)).meanLuma).toBeCloseTo(0.114 * 255, 6)
  })

  it('cannot measure sharpness under 3×3, and does not call that blurry', () => {
    const q = assessPhotoQuality(image(2, 2, () => 128))
    expect(q.sharpness).toBeNull()
    expect(q.issue).toBeNull()
  })
})
