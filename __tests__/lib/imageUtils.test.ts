import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeTargetDimensions } from '@/lib/imageUtils'

describe('computeTargetDimensions', () => {
  it('returns original dimensions when both are under maxDim', () => {
    expect(computeTargetDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('returns original dimensions when exactly at maxDim', () => {
    expect(computeTargetDimensions(2048, 2048)).toEqual({ width: 2048, height: 2048 })
  })

  it('scales down a landscape image correctly', () => {
    const { width, height } = computeTargetDimensions(4096, 2048)
    expect(width).toBe(2048)
    expect(height).toBe(1024)
  })

  it('scales down a portrait image correctly', () => {
    const { width, height } = computeTargetDimensions(1024, 4096)
    expect(width).toBe(512)
    expect(height).toBe(2048)
  })

  it('scales by limiting dimension when both exceed maxDim', () => {
    const { width, height } = computeTargetDimensions(4000, 3000, 2048)
    expect(width).toBe(2048)
    expect(height).toBe(Math.round(3000 * (2048 / 4000)))
  })

  it('accepts a custom maxDim', () => {
    const { width, height } = computeTargetDimensions(2000, 1000, 1000)
    expect(width).toBe(1000)
    expect(height).toBe(500)
  })

  it('returns integer dimensions (Math.round)', () => {
    const { width, height } = computeTargetDimensions(3000, 2001, 2048)
    expect(Number.isInteger(width)).toBe(true)
    expect(Number.isInteger(height)).toBe(true)
  })
})

// ── Shared mock helpers ──────────────────────────────────────────────────
// Canvas mock — returns the canvas, its 2D context spy, and exposes a
// configurable toBlob so individual tests can simulate quality-loop outcomes.
function makeCanvasMock(opts: { toBlobOutputs?: (Blob | null)[] } = {}) {
  const ctx = {
    drawImage: vi.fn(),
    rotate:    vi.fn(),
    translate: vi.fn(),
  }
  const toBlobOutputs = opts.toBlobOutputs
  let toBlobCallIdx = 0
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb: (b: Blob | null) => void) => {
      if (toBlobOutputs) {
        const out = toBlobOutputs[toBlobCallIdx] ?? null
        toBlobCallIdx += 1
        cb(out)
      } else {
        // Default: always succeed with a tiny blob (below any reasonable maxBytes).
        cb(new Blob(['x'], { type: 'image/jpeg' }))
      }
    }),
    toDataURL: vi.fn(() => 'data:image/png;base64,'),
  }
  return { canvas, ctx }
}

// createImageBitmap mock. Tests pass the *post-EXIF-decode* dimensions
// directly, since the real browser applies orientation before we see
// width/height. Captures the options so we can assert we passed
// imageOrientation: 'from-image' — the whole point of the fix.
function installBitmapMock(width: number, height: number) {
  const close = vi.fn()
  const impl = vi.fn(async () => ({ width, height, close }))
  vi.stubGlobal('createImageBitmap', impl)
  return { close, impl }
}

function installDocMock(canvas: ReturnType<typeof makeCanvasMock>['canvas']) {
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
}

describe('compressImage', () => {
  beforeEach(async () => {
    // Reset the WebP feature-detect cache between specs so each test starts
    // from a clean state — WebP output vs. JPEG output changes assertions.
    const m = await import('@/lib/imageUtils')
    m._resetWebPCache()
  })

  // ── EXIF orientation — the core reason this fix exists ──────────────────

  it('calls createImageBitmap with imageOrientation: from-image', async () => {
    const { impl } = installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file)

    expect(impl).toHaveBeenCalledTimes(1)
    expect(impl).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
  })

  it('uses EXIF-corrected dimensions for the canvas (bitmap dims, not file dims)', async () => {
    // Simulates an iPhone JPEG whose raw bytes are 4032×3024 but whose EXIF
    // says rotate 90° CW — the decoded bitmap is 3024×4032.
    installBitmapMock(3024, 4032)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File([new Uint8Array(500_000)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file)

    // Longest edge 4032 → scaled down to 2048. Matches computeTargetDimensions.
    expect(canvas.width).toBe(Math.round(3024 * (2048 / 4032)))
    expect(canvas.height).toBe(2048)
  })

  // ── Orientation preservation (no more forceLandscape rotation) ──────────

  it('keeps portrait photos portrait — no rotation applied', async () => {
    installBitmapMock(1200, 1600)  // portrait
    const { canvas, ctx } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file)

    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(1600)
    expect(ctx.rotate).not.toHaveBeenCalled()
    expect(ctx.translate).not.toHaveBeenCalled()
  })

  it('keeps landscape photos landscape', async () => {
    installBitmapMock(1600, 1200)
    const { canvas, ctx } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file)

    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(1200)
    expect(ctx.rotate).not.toHaveBeenCalled()
  })

  it('keeps square photos square', async () => {
    installBitmapMock(1000, 1000)
    const { canvas, ctx } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file)

    expect(canvas.width).toBe(1000)
    expect(canvas.height).toBe(1000)
    expect(ctx.rotate).not.toHaveBeenCalled()
  })

  // ── Re-encode always runs (previous fast-path for small files is gone) ──

  it('re-encodes small files too so EXIF is baked into the bytes', async () => {
    // Crucial for PDF output — pdf-lib embeds raw bytes, so if we skip the
    // re-encode on small JPEGs with non-identity EXIF, the PDF is sideways.
    installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const small = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(small)

    expect(result).not.toBe(small)  // new File, not the original
    expect(canvas.toBlob).toHaveBeenCalled()
  })

  // ── Resize ──────────────────────────────────────────────────────────────

  it('scales an oversized landscape image to fit 2048 on the longest edge', async () => {
    installBitmapMock(4096, 2048)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const big = new File([new Uint8Array(2_000_000)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(big, 1_000_000)

    expect(canvas.width).toBe(2048)
    expect(canvas.height).toBe(1024)
  })

  it('scales an oversized portrait image to fit 2048 on the longest edge', async () => {
    installBitmapMock(2048, 4096)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const big = new File([new Uint8Array(2_000_000)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(big, 1_000_000)

    expect(canvas.width).toBe(1024)
    expect(canvas.height).toBe(2048)
  })

  it('does not upscale images smaller than 2048 on both edges', async () => {
    installBitmapMock(500, 400)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file)

    expect(canvas.width).toBe(500)
    expect(canvas.height).toBe(400)
  })

  // ── Encoding format & filename ──────────────────────────────────────────

  it('renames the file extension to .jpg when WebP is unsupported', async () => {
    installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock()
    // toDataURL returns PNG by default → WebP feature-detect says "no WebP".
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File([new Uint8Array(2_000_000)], 'photo.HEIC', { type: 'image/heic' })
    const result = await compressImage(file)

    expect(result.name).toBe('photo.jpg')
    expect(result.type).toBe('image/jpeg')
  })

  it('renames the file extension to .webp when WebP is supported', async () => {
    installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock()
    canvas.toDataURL = vi.fn(() => 'data:image/webp;base64,xyz')
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File([new Uint8Array(2_000_000)], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(file)

    expect(result.name).toBe('photo.webp')
    expect(result.type).toBe('image/webp')
  })

  // ── Quality loop ────────────────────────────────────────────────────────

  it('accepts the first quality step that fits under maxBytes', async () => {
    const big = new Blob([new Uint8Array(2_000_000)], { type: 'image/jpeg' })
    const small = new Blob([new Uint8Array(500)], { type: 'image/jpeg' })
    // First attempt (0.85) is too big, second (0.75) fits.
    installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock({ toBlobOutputs: [big, small, small] })
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File([new Uint8Array(2_000_000)], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(file, 1_000_000)

    expect(canvas.toBlob).toHaveBeenCalledTimes(2)
    expect(result.size).toBeLessThanOrEqual(1_000_000)
  })

  it('falls back to the last-resort quality when every step exceeds maxBytes', async () => {
    const oversized = new Blob([new Uint8Array(2_000_000)], { type: 'image/jpeg' })
    // All 9 QUALITY_STEPS exceed maxBytes → 10th call (quality 0.05 last-resort) returns a blob.
    const lastResort = new Blob([new Uint8Array(1_500_000)], { type: 'image/jpeg' })
    installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock({
      toBlobOutputs: [
        oversized, oversized, oversized, oversized, oversized,
        oversized, oversized, oversized, oversized,
        lastResort,
      ],
    })
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File([new Uint8Array(2_000_000)], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(file, 1_000_000)

    expect(canvas.toBlob).toHaveBeenCalledTimes(10)
    // Accepts the oversized last-resort blob rather than failing.
    expect(result.size).toBe(1_500_000)
  })

  // ── Error paths ─────────────────────────────────────────────────────────

  it('throws when the canvas 2D context is unavailable', async () => {
    installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock()
    canvas.getContext = vi.fn(() => null)
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })

    await expect(compressImage(file)).rejects.toThrow('Canvas 2D context not available')
  })

  it('throws when every toBlob attempt — including last-resort — returns null', async () => {
    installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock({
      toBlobOutputs: Array<null>(10).fill(null),
    })
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })

    await expect(compressImage(file)).rejects.toThrow('Could not compress image')
  })

  it('propagates createImageBitmap failures (unsupported format, corrupt file)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('The source image could not be decoded')
    }))
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File([new Uint8Array(100)], 'corrupt.jpg', { type: 'image/jpeg' })

    await expect(compressImage(file)).rejects.toThrow('could not be decoded')
  })

  // ── Resource cleanup ────────────────────────────────────────────────────

  it('releases the ImageBitmap via close() on success', async () => {
    const { close } = installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file)

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('releases the ImageBitmap via close() even when the canvas context fails', async () => {
    const { close } = installBitmapMock(800, 600)
    const { canvas } = makeCanvasMock()
    canvas.getContext = vi.fn(() => null)
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const file = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file)).rejects.toThrow()

    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('supportsWebP', () => {
  beforeEach(async () => {
    const m = await import('@/lib/imageUtils')
    m._resetWebPCache()
  })

  it('returns false when toDataURL does not yield a webp data URL', async () => {
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0, height: 0,
        toDataURL: vi.fn(() => 'data:image/png;base64,xyz'),
      })),
    })
    const { supportsWebP } = await import('@/lib/imageUtils')
    expect(supportsWebP()).toBe(false)
  })

  it('returns true when toDataURL yields a webp data URL', async () => {
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0, height: 0,
        toDataURL: vi.fn(() => 'data:image/webp;base64,xyz'),
      })),
    })
    const { supportsWebP } = await import('@/lib/imageUtils')
    expect(supportsWebP()).toBe(true)
  })

  it('caches the result across calls', async () => {
    const toDataURL = vi.fn(() => 'data:image/webp;base64,')
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ width: 0, height: 0, toDataURL })),
    })
    const { supportsWebP } = await import('@/lib/imageUtils')
    supportsWebP()
    supportsWebP()
    supportsWebP()
    expect(toDataURL).toHaveBeenCalledTimes(1)
  })

  it('falls back to false when probing throws', async () => {
    vi.stubGlobal('document', {
      createElement: vi.fn(() => { throw new Error('no canvas') }),
    })
    const { supportsWebP } = await import('@/lib/imageUtils')
    expect(supportsWebP()).toBe(false)
  })
})
