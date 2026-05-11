import { describe, expect, it } from 'vitest'
import {
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
