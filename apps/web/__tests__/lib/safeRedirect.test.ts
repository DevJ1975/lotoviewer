import { describe, it, expect } from 'vitest'
import { safeRedirect } from '@/lib/security/safeRedirect'

describe('safeRedirect', () => {
  it('keeps an ordinary in-app path intact', () => {
    expect(safeRedirect('/departments')).toBe('/departments')
  })

  it('preserves query and fragment on a same-origin path', () => {
    expect(safeRedirect('/equipment/42?tab=photos#top')).toBe(
      '/equipment/42?tab=photos#top',
    )
  })

  it('falls back when no target is supplied', () => {
    expect(safeRedirect(null)).toBe('/')
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect('')).toBe('/')
  })

  it('honours a caller-supplied fallback', () => {
    expect(safeRedirect('https://evil.example', '/welcome')).toBe('/welcome')
  })

  it('rejects an absolute URL on another origin', () => {
    expect(safeRedirect('https://evil.example/pwned')).toBe('/')
    expect(safeRedirect('http://evil.example')).toBe('/')
  })

  it('rejects protocol-relative targets', () => {
    // "//evil.example" inherits the current scheme and is fully off-site.
    expect(safeRedirect('//evil.example')).toBe('/')
    expect(safeRedirect('//evil.example/path')).toBe('/')
  })

  it('rejects backslash variants that browsers normalise to "//"', () => {
    expect(safeRedirect('/\\evil.example')).toBe('/')
    expect(safeRedirect('\\\\evil.example')).toBe('/')
  })

  it('rejects targets that smuggle control characters past a prefix check', () => {
    // The URL parser strips tab/newline before resolving, so "/\t/evil" would
    // become protocol-relative under a naive startsWith('//') guard.
    expect(safeRedirect('/\t/evil.example')).toBe('/')
    expect(safeRedirect('/\n/evil.example')).toBe('/')
  })

  it('rejects non-http schemes', () => {
    expect(safeRedirect('javascript:alert(1)')).toBe('/')
    expect(safeRedirect('data:text/html,<script>alert(1)</script>')).toBe('/')
  })
})
