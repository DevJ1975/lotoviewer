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

describe('compressImage (canvas mock)', () => {
  beforeEach(() => {
    // Mock URL.createObjectURL / revokeObjectURL
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })

    // Mock Image loading
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null
      set src(_: string) { this.onload?.() }
      width = 800
      height = 600
    })

    // Mock canvas → produces a small blob immediately
    const mockBlob = new Blob(['x'], { type: 'image/jpeg' })
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(mockBlob)),
    }
    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockCanvas),
    })
  })

  it('returns the original file if it is already under maxBytes', async () => {
    const { compressImage } = await import('@/lib/imageUtils')
    const small = new File(['x'.repeat(500)], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(small, 1_000_000)
    expect(result).toBe(small)
  })
})
