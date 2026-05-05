import { describe, it, expect } from 'vitest'
import { formatWorkOrderUrl } from '@soteria/core/orgConfig'

describe('formatWorkOrderUrl', () => {
  it('returns null when the template is not configured', () => {
    expect(formatWorkOrderUrl(null,      'WO-123')).toBeNull()
    expect(formatWorkOrderUrl(undefined, 'WO-123')).toBeNull()
    expect(formatWorkOrderUrl('',        'WO-123')).toBeNull()
  })

  it('returns null when the ref is blank', () => {
    expect(formatWorkOrderUrl('https://x/{ref}', null)).toBeNull()
    expect(formatWorkOrderUrl('https://x/{ref}', '')).toBeNull()
  })

  it('returns null when the template lacks a {ref} placeholder — almost always a misconfig', () => {
    expect(formatWorkOrderUrl('https://maintainx.com/wo', 'WO-123')).toBeNull()
  })

  it('substitutes a single {ref} occurrence', () => {
    expect(formatWorkOrderUrl('https://maintainx.com/wo/{ref}', 'WO-123'))
      .toBe('https://maintainx.com/wo/WO-123')
  })

  it('substitutes every occurrence — query-string templates sometimes repeat', () => {
    expect(formatWorkOrderUrl('https://x/{ref}?id={ref}', 'A1'))
      .toBe('https://x/A1?id=A1')
  })

  it('percent-encodes the ref so spaces and slashes survive routing', () => {
    expect(formatWorkOrderUrl('https://x/{ref}', 'WO 123/sub'))
      .toBe('https://x/WO%20123%2Fsub')
  })

  it('trims whitespace around the ref before substituting', () => {
    expect(formatWorkOrderUrl('https://x/{ref}', '  WO-1  ')).toBe('https://x/WO-1')
  })
})
