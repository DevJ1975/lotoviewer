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

// ── Edge cases: host allow-list, segment shapes, and boundary lengths ─────
// The parser is the security boundary (it decides what id can ever reach a
// player.vimeo.com iframe), so these hammer the host/segment/length rules.

describe('parseVimeoReference — host & segment edge cases', () => {
  it('accepts the www.vimeo.com host', () => {
    expect(parseVimeoReference('https://www.vimeo.com/123456789'))
      .toEqual({ videoId: '123456789', hash: null })
  })

  it('matches the host case-insensitively', () => {
    expect(parseVimeoReference('HTTPS://VIMEO.COM/123456789'))
      .toEqual({ videoId: '123456789', hash: null })
  })

  it('accepts a player.vimeo.com embed URL without a hash', () => {
    expect(parseVimeoReference('https://player.vimeo.com/video/123456789'))
      .toEqual({ videoId: '123456789', hash: null })
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(parseVimeoReference('  https://vimeo.com/123456789  '))
      .toEqual({ videoId: '123456789', hash: null })
  })

  it('treats a trailing slash as no hash', () => {
    expect(parseVimeoReference('https://vimeo.com/123456789/'))
      .toEqual({ videoId: '123456789', hash: null })
  })

  it('treats an empty ?h= as no hash', () => {
    expect(parseVimeoReference('https://player.vimeo.com/video/123456789?h='))
      .toEqual({ videoId: '123456789', hash: null })
  })

  it('rejects a channel-style URL whose first segment is not the id', () => {
    expect(parseVimeoReference('https://vimeo.com/channels/staffpicks/123456789')).toBeNull()
  })

  it('prefers the path hash over the query hash when both are present', () => {
    expect(parseVimeoReference('https://vimeo.com/123456789/pathhash01?h=queryhash9'))
      .toEqual({ videoId: '123456789', hash: 'pathhash01' })
  })
})

describe('parseVimeoReference — id & hash length boundaries', () => {
  it('accepts the shortest (6-digit) and longest (12-digit) ids', () => {
    expect(parseVimeoReference('123456')).toEqual({ videoId: '123456', hash: null })
    expect(parseVimeoReference('123456789012')).toEqual({ videoId: '123456789012', hash: null })
  })

  it('rejects a 13-digit id as out of range', () => {
    expect(parseVimeoReference('1234567890123')).toBeNull()
  })

  it('drops a hash that is too short but keeps the valid id', () => {
    expect(parseVimeoReference('https://vimeo.com/123456789/abc'))
      .toEqual({ videoId: '123456789', hash: null })
  })

  it('drops a hash that is too long (>20) but keeps the valid id', () => {
    expect(parseVimeoReference(`https://vimeo.com/123456789/${'a'.repeat(21)}`))
      .toEqual({ videoId: '123456789', hash: null })
  })

  it('drops an uppercase hash that fails the lowercase-alnum rule', () => {
    expect(parseVimeoReference('https://vimeo.com/123456789/ABCDEF0123'))
      .toEqual({ videoId: '123456789', hash: null })
  })
})

describe('resolveStrikeVideo — edge cases', () => {
  it('trims surrounding whitespace on the stored id', () => {
    expect(resolveStrikeVideo({ video_external_id: '  123456789  ' }))
      .toEqual({ kind: 'vimeo', videoId: '123456789', hash: null })
  })

  it('resolves the shortest valid (6-digit) id and rejects a 5-digit one', () => {
    expect(resolveStrikeVideo({ video_external_id: '123456' }))
      .toEqual({ kind: 'vimeo', videoId: '123456', hash: null })
    expect(resolveStrikeVideo({ video_external_id: '12345' }))
      .toMatchObject({ kind: 'unsupported' })
  })

  it('ignores a non-string stored hash', () => {
    expect(resolveStrikeVideo({ video_external_id: '123456789', video_meta: { vimeo_hash: 12345 } }))
      .toEqual({ kind: 'vimeo', videoId: '123456789', hash: null })
  })

  it('returns a null hash when video_meta is an empty object', () => {
    expect(resolveStrikeVideo({ video_external_id: '123456789', video_meta: {} }))
      .toEqual({ kind: 'vimeo', videoId: '123456789', hash: null })
  })
})
