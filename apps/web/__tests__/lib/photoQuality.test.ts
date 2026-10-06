import { describe, it, expect, vi, afterEach } from 'vitest'
import { ANALYSIS_LONG_SIDE } from '@soteria/core/photoQuality'
import { measurePhotoQuality } from '@/lib/photoQuality'

// The scoring itself is covered in packages/core; these pin the browser glue:
// EXIF-aware decode, downscale to the calibrated size, and "never block".

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A canvas whose getImageData returns a uniform grey of the drawn size. */
function installCanvas(luma: number) {
  const ctx = {
    drawImage:    vi.fn(),
    imageSmoothingQuality: 'low',
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      width, height, data: new Uint8ClampedArray(width * height * 4).fill(luma),
    })),
  }
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
  return { canvas, ctx }
}

function installBitmap(width: number, height: number) {
  const close = vi.fn()
  const decode = vi.fn(async () => ({ width, height, close }))
  vi.stubGlobal('createImageBitmap', decode)
  return { close, decode }
}

const photo = new File(['x'], 'iso.jpg', { type: 'image/jpeg' })

describe('measurePhotoQuality', () => {
  it('decodes with EXIF orientation and analyses at the calibrated size', async () => {
    const { decode, close } = installBitmap(4032, 3024)
    const { canvas, ctx } = installCanvas(128)

    const quality = await measurePhotoQuality(photo)

    expect(decode).toHaveBeenCalledWith(photo, { imageOrientation: 'from-image' })
    expect(Math.max(canvas.width, canvas.height)).toBe(ANALYSIS_LONG_SIDE)
    expect(ctx.imageSmoothingQuality).toBe('high')
    expect(quality?.meanLuma).toBeCloseTo(128, 5)
    expect(close).toHaveBeenCalled()
  })

  it('reports the issue the scorer finds', async () => {
    installBitmap(1000, 750)
    installCanvas(10)
    expect((await measurePhotoQuality(photo))?.issue).toBe('too_dark')
  })

  it('returns null, never throws, when the browser cannot decode the file', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('The source image could not be decoded.') }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await measurePhotoQuality(photo)).toBeNull()
  })

  it('returns null when no 2D context is available', async () => {
    const { close } = installBitmap(800, 600)
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ getContext: () => null })) })
    expect(await measurePhotoQuality(photo)).toBeNull()
    expect(close).toHaveBeenCalled()
  })
})
