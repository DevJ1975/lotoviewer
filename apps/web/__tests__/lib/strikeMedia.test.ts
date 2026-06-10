import { describe, expect, it } from 'vitest'
import {
  isValidStrikeStorageVideoPath,
  resolveStrikeVideo,
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

describe('resolveStrikeVideo', () => {
  const STREAM_UID = 'a'.repeat(32)

  it('resolves cloudflare versions with a valid stream UID', () => {
    expect(resolveStrikeVideo({
      video_provider: 'cloudflare',
      video_external_id: STREAM_UID,
      video_path: 'global/archive/original.mp4',
    })).toEqual({ kind: 'stream', provider: 'cloudflare', videoId: STREAM_UID })
  })

  it('fails closed when a cloudflare version has a missing or malformed UID', () => {
    expect(resolveStrikeVideo({ video_provider: 'cloudflare', video_external_id: null }))
      .toMatchObject({ kind: 'unsupported' })
    expect(resolveStrikeVideo({ video_provider: 'cloudflare', video_external_id: 'not-a-uid' }))
      .toMatchObject({ kind: 'unsupported' })
    expect(resolveStrikeVideo({ video_provider: 'cloudflare', video_external_id: 'https://evil.example/x' }))
      .toMatchObject({ kind: 'unsupported' })
  })

  it('falls through to storage path validation for storage versions', () => {
    expect(resolveStrikeVideo({ video_provider: 'storage', video_path: 'global/loto/refresher.mp4' }))
      .toEqual({ kind: 'storage', path: 'global/loto/refresher.mp4' })
    expect(resolveStrikeVideo({ video_provider: null, video_path: 'global/loto/refresher.mp4' }))
      .toEqual({ kind: 'storage', path: 'global/loto/refresher.mp4' })
    expect(resolveStrikeVideo({ video_provider: 'storage', video_path: 'https://vimeo.com/123' }))
      .toMatchObject({ kind: 'unsupported' })
    expect(resolveStrikeVideo({ video_provider: 'storage', video_path: null }))
      .toEqual({ kind: 'none' })
  })

  it('rejects unknown providers', () => {
    expect(resolveStrikeVideo({ video_provider: 'youtube', video_external_id: STREAM_UID }))
      .toMatchObject({ kind: 'unsupported' })
  })
})
