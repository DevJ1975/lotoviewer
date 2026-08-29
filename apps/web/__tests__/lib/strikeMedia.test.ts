import { describe, expect, it } from 'vitest'
import {
  parseVimeoReference,
  resolveStrikeVideo,
  vimeoEmbedUrl,
} from '@soteria/core/strikeMedia'

describe('parseVimeoReference', () => {
  it('accepts a bare numeric id', () => {
    expect(parseVimeoReference('123456789')).toEqual({ videoId: '123456789', hash: null })
  })

  it('accepts a vimeo.com link, with or without a scheme', () => {
    expect(parseVimeoReference('https://vimeo.com/123456789')).toEqual({ videoId: '123456789', hash: null })
    expect(parseVimeoReference('vimeo.com/123456789')).toEqual({ videoId: '123456789', hash: null })
  })

  it('extracts the unlisted privacy hash from a path or a query string', () => {
    expect(parseVimeoReference('https://vimeo.com/123456789/abcdef0123'))
      .toEqual({ videoId: '123456789', hash: 'abcdef0123' })
    expect(parseVimeoReference('https://player.vimeo.com/video/123456789?h=abcdef0123'))
      .toEqual({ videoId: '123456789', hash: 'abcdef0123' })
  })

  it('rejects non-Vimeo hosts and junk so no arbitrary src can slip through', () => {
    expect(parseVimeoReference('https://youtube.com/watch?v=123456789')).toBeNull()
    expect(parseVimeoReference('https://evil.example/123456789')).toBeNull()
    expect(parseVimeoReference('not a url')).toBeNull()
    expect(parseVimeoReference('')).toBeNull()
    expect(parseVimeoReference('   ')).toBeNull()
  })

  it('rejects ids too short to be Vimeo ids', () => {
    expect(parseVimeoReference('https://vimeo.com/123')).toBeNull()
  })
})

describe('resolveStrikeVideo', () => {
  it('resolves a Vimeo id with its stored hash', () => {
    expect(resolveStrikeVideo({ video_external_id: '123456789', video_meta: { vimeo_hash: 'abcdef0123' } }))
      .toEqual({ kind: 'vimeo', videoId: '123456789', hash: 'abcdef0123' })
  })

  it('resolves a Vimeo id without a hash', () => {
    expect(resolveStrikeVideo({ video_external_id: '123456789' }))
      .toEqual({ kind: 'vimeo', videoId: '123456789', hash: null })
  })

  it('ignores a malformed stored hash rather than embedding it', () => {
    expect(resolveStrikeVideo({ video_external_id: '123456789', video_meta: { vimeo_hash: 'NO!' } }))
      .toEqual({ kind: 'vimeo', videoId: '123456789', hash: null })
  })

  it('returns none for a blank id', () => {
    expect(resolveStrikeVideo({ video_external_id: null })).toEqual({ kind: 'none' })
    expect(resolveStrikeVideo({ video_external_id: '  ' })).toEqual({ kind: 'none' })
  })

  it('fails closed for a non-Vimeo id (e.g. a stale Cloudflare UID on a legacy row)', () => {
    expect(resolveStrikeVideo({ video_external_id: 'a'.repeat(32) }))
      .toMatchObject({ kind: 'unsupported' })
  })
})

describe('vimeoEmbedUrl', () => {
  it('builds a do-not-track embed URL without a hash', () => {
    expect(vimeoEmbedUrl('123456789', null)).toBe('https://player.vimeo.com/video/123456789?dnt=1')
  })

  it('includes the privacy hash when present', () => {
    expect(vimeoEmbedUrl('123456789', 'abcdef0123'))
      .toBe('https://player.vimeo.com/video/123456789?h=abcdef0123&dnt=1')
  })
})
