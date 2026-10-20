import { describe, expect, it } from 'vitest'
import { latestVersionPerLocale, pickStrikeLocale } from '../strikeLocale'

describe('latestVersionPerLocale', () => {
  it('keeps the newest version of each language independently', () => {
    const latest = latestVersionPerLocale([
      { id: 'en1', locale: 'en', version_number: 1 },
      { id: 'es2', locale: 'es', version_number: 2 },
      { id: 'en3', locale: 'en', version_number: 3 },
    ])
    expect(latest.get('en')?.id).toBe('en3')
    expect(latest.get('es')?.id).toBe('es2')
  })
})

describe('pickStrikeLocale', () => {
  it("honors the learner's choice when the module has it", () => {
    expect(pickStrikeLocale(['en', 'es'], 'es')).toBe('es')
  })

  it('falls back to English, then to whatever exists', () => {
    expect(pickStrikeLocale(['en', 'es'], 'fr')).toBe('en')
    expect(pickStrikeLocale(['es'], 'en')).toBe('es')
    expect(pickStrikeLocale([], 'en')).toBeNull()
  })
})
