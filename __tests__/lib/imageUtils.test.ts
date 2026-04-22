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

// ── Shared canvas mock factory ──────────────────────────────────────────────
// Returns a canvas mock plus call-trackers for the operations we care about
// (rotate, translate, drawImage). Callers can also override the canvas.toBlob
// behavior to simulate quality loop outcomes.
function makeCanvasMock() {
  const ctx = {
    drawImage: vi.fn(),
    rotate:    vi.fn(),
    translate: vi.fn(),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob:     vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' }))),
    toDataURL:  vi.fn(() => 'data:image/png;base64,'),  // pretend WebP unsupported
  }
  return { canvas, ctx }
}

function installImageMock(naturalWidth: number, naturalHeight: number) {
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null
    naturalWidth = naturalWidth
    naturalHeight = naturalHeight
    set src(_: string) { setTimeout(() => this.onload?.(), 0) }
  })
}

function installUrlMock() {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  })
}

function installDocMock(canvas: ReturnType<typeof makeCanvasMock>['canvas']) {
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
}

describe('compressImage (canvas mock)', () => {
  beforeEach(async () => {
    installUrlMock()
    // Reset the WebP feature-detect cache between specs so each test starts
    // from a clean state.
    const m = await import('@/lib/imageUtils')
    m._resetWebPCache()
  })

  it('skips load entirely when forceLandscape is off and file is small', async () => {
    installImageMock(800, 600)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const small = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(small, 1_000_000, /* forceLandscape */ false)

    expect(result).toBe(small)
    expect(canvas.toBlob).not.toHaveBeenCalled()
    expect(canvas.getContext).not.toHaveBeenCalled()
  })

  it('returns original small landscape file even with forceLandscape=true (no re-encode)', async () => {
    installImageMock(800, 600)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const small = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(small, 1_000_000)

    expect(result).toBe(small)
    expect(canvas.toBlob).not.toHaveBeenCalled()
  })

  it('rotates a small portrait file even though it is under maxBytes', async () => {
    installImageMock(600, 800)  // portrait
    const { canvas, ctx } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const small = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(small, 1_000_000)

    // Output is a re-encoded landscape file, not the original.
    expect(result).not.toBe(small)
    // Canvas dims swap: width=800 (was naturalHeight), height=600 (was naturalWidth).
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(600)
    // Rotation pipeline ran.
    expect(ctx.translate).toHaveBeenCalledWith(800, 0)
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2)
  })

  it('does NOT rotate landscape files even when oversized', async () => {
    installImageMock(800, 600)
    const { canvas, ctx } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    // 2 MB > 1 MB threshold → triggers compression path
    const big = new File([new Uint8Array(2_000_000)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(big, 1_000_000)

    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(600)
    expect(ctx.rotate).not.toHaveBeenCalled()
    expect(ctx.translate).not.toHaveBeenCalled()
    expect(ctx.drawImage).toHaveBeenCalled()
  })

  it('does NOT rotate square files', async () => {
    installImageMock(1000, 1000)
    const { canvas, ctx } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const big = new File([new Uint8Array(2_000_000)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(big, 1_000_000)

    expect(ctx.rotate).not.toHaveBeenCalled()
  })

  it('respects forceLandscape=false: portrait file is not rotated', async () => {
    installImageMock(600, 800)  // portrait
    const { canvas, ctx } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const big = new File([new Uint8Array(2_000_000)], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(big, 1_000_000, /* forceLandscape */ false)

    expect(ctx.rotate).not.toHaveBeenCalled()
    // Width/height stay portrait (no swap).
    expect(canvas.width).toBe(600)
    expect(canvas.height).toBe(800)
  })

  it('renames the file extension to match the chosen output mime', async () => {
    installImageMock(800, 600)
    const { canvas } = makeCanvasMock()
    installDocMock(canvas)

    const { compressImage } = await import('@/lib/imageUtils')
    const big = new File([new Uint8Array(2_000_000)], 'photo.HEIC', { type: 'image/heic' })
    const result = await compressImage(big, 1_000_000)

    // No WebP support in mock → JPEG output.
    expect(result.name).toBe('photo.jpg')
    expect(result.type).toBe('image/jpeg')
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
