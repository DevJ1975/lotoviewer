import { describe, expect, it } from 'vitest'
import {
  isValidStrikeStorageThumbnailPath,
  isValidStrikeStorageVideoPath,
  resolveStrikeVideoSource,
} from '@soteria/core/strikeMedia'

describe('resolveStrikeVideoSource', () => {
  it('recognizes private STRIKE storage paths', () => {
    expect(resolveStrikeVideoSource('global/loto/refresher.mp4')).toEqual({
      kind: 'storage',
      path: 'global/loto/refresher.mp4',
    })
  })

  it('recognizes tenant-scoped STRIKE storage paths', () => {
    expect(resolveStrikeVideoSource('11111111-1111-4111-8111-111111111111/strike/video.webm')).toEqual({
      kind: 'storage',
      path: '11111111-1111-4111-8111-111111111111/strike/video.webm',
    })
  })

  it('rejects traversal and unsupported storage paths', () => {
    expect(resolveStrikeVideoSource('global/../secret.mp4')).toMatchObject({ kind: 'unsupported' })
    expect(resolveStrikeVideoSource('global/training.exe')).toMatchObject({ kind: 'unsupported' })
    expect(resolveStrikeVideoSource('/global/training.mp4')).toMatchObject({ kind: 'unsupported' })
  })

  it('rejects external video URLs', () => {
    expect(resolveStrikeVideoSource('https://vimeo.com/123456789?h=abc123')).toMatchObject({
      kind: 'unsupported',
      reason: 'STRIKE videos must be uploaded to Supabase Storage.',
    })
    expect(resolveStrikeVideoSource('https://example.com/training.mp4')).toMatchObject({
      kind: 'unsupported',
      reason: 'STRIKE videos must be uploaded to Supabase Storage.',
    })
  })
})

describe('isValidStrikeStorageVideoPath', () => {
  it('requires global or tenant UUID path roots', () => {
    expect(isValidStrikeStorageVideoPath('global/path/file.mp4')).toBe(true)
    expect(isValidStrikeStorageVideoPath('tenant/path/file.mp4')).toBe(false)
  })
})

describe('isValidStrikeStorageThumbnailPath', () => {
  it('accepts standard still-image extensions under global or tenant roots', () => {
    expect(isValidStrikeStorageThumbnailPath('global/loto/thumb.jpg')).toBe(true)
    expect(isValidStrikeStorageThumbnailPath('global/loto/thumb.jpeg')).toBe(true)
    expect(isValidStrikeStorageThumbnailPath('global/loto/thumb.png')).toBe(true)
    expect(isValidStrikeStorageThumbnailPath('global/loto/thumb.webp')).toBe(true)
    expect(isValidStrikeStorageThumbnailPath('global/loto/thumb.avif')).toBe(true)
    expect(isValidStrikeStorageThumbnailPath(
      '11111111-1111-4111-8111-111111111111/strike/thumb.webp',
    )).toBe(true)
  })

  it('rejects video and animated formats', () => {
    expect(isValidStrikeStorageThumbnailPath('global/loto/thumb.mp4')).toBe(false)
    expect(isValidStrikeStorageThumbnailPath('global/loto/thumb.gif')).toBe(false)
  })

  it('rejects unsafe roots and traversal segments', () => {
    expect(isValidStrikeStorageThumbnailPath('public/loto/thumb.png')).toBe(false)
    expect(isValidStrikeStorageThumbnailPath('global/../secret.png')).toBe(false)
    expect(isValidStrikeStorageThumbnailPath('/global/thumb.png')).toBe(false)
  })
})
