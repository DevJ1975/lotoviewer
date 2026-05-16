import { describe, it, expect } from 'vitest'
import {
  buildLongFormWarning,
  buildShortFormWarning,
} from '@soteria/core/prop65WarningText'

describe('buildLongFormWarning', () => {
  it('renders the safe-harbor symbol prefix and reference URL (EN)', () => {
    const out = buildLongFormWarning({
      chemicals: [{ name: 'Lead', endpoint: 'both' }],
      language:  'en',
    })
    expect(out).toContain('⚠ WARNING:')
    expect(out).toContain('www.P65Warnings.ca.gov')
  })

  it('renders the Spanish prefix when language=es', () => {
    const out = buildLongFormWarning({
      chemicals: [{ name: 'Plomo', endpoint: 'cancer' }],
      language:  'es',
    })
    expect(out).toContain('⚠ ADVERTENCIA:')
    expect(out).toContain('Estado de California')
  })

  it('produces a cancer-only clause for cancer endpoint', () => {
    const out = buildLongFormWarning({
      chemicals: [{ name: 'Benzene', endpoint: 'cancer' }],
      language:  'en',
    })
    expect(out).toContain('Benzene')
    expect(out).toContain('cancer')
    expect(out).not.toContain('birth defects')
  })

  it('produces a reproductive-only clause for repro endpoint', () => {
    const out = buildLongFormWarning({
      chemicals: [{ name: 'BPA', endpoint: 'reproductive' }],
      language:  'en',
    })
    expect(out).toContain('birth defects')
    expect(out).not.toContain('cause cancer')
  })

  it('combines clause for both endpoint', () => {
    const out = buildLongFormWarning({
      chemicals: [{ name: 'Lead', endpoint: 'both' }],
      language:  'en',
    })
    expect(out).toContain('cancer and birth defects')
  })

  it('joins multiple chemicals within an endpoint bucket', () => {
    const out = buildLongFormWarning({
      chemicals: [
        { name: 'Benzene',  endpoint: 'cancer' },
        { name: 'Styrene',  endpoint: 'cancer' },
      ],
      language: 'en',
    })
    expect(out).toContain('Benzene, Styrene')
  })

  it('emits separate clauses when chemicals span endpoints', () => {
    const out = buildLongFormWarning({
      chemicals: [
        { name: 'Benzene', endpoint: 'cancer' },
        { name: 'BPA',     endpoint: 'reproductive' },
      ],
      language: 'en',
    })
    expect(out).toContain('cause cancer')
    expect(out).toContain('birth defects')
  })

  it('preserves parens in chemical names without escaping them', () => {
    // DEHP is a known PDF-pipeline footgun — parens have historically
    // been mangled by escape passes. Verify the literal makes it through.
    const out = buildLongFormWarning({
      chemicals: [{ name: 'Di(2-ethylhexyl)phthalate (DEHP)', endpoint: 'both' }],
      language:  'en',
    })
    expect(out).toContain('Di(2-ethylhexyl)phthalate (DEHP)')
  })

  it('throws on empty input', () => {
    expect(() => buildLongFormWarning({ chemicals: [], language: 'en' }))
      .toThrow(/at least one chemical/i)
  })
})

describe('buildShortFormWarning', () => {
  it('includes warning symbol and the abbreviated heading', () => {
    const out = buildShortFormWarning({
      chemicals: [{ name: 'Lead', endpoint: 'cancer' }],
      language:  'en',
    })
    expect(out).toContain('⚠ WARNING:')
    expect(out).toContain('Cancer Risk')
  })

  it('uses the combined heading when any chemical is both-endpoint', () => {
    const out = buildShortFormWarning({
      chemicals: [{ name: 'Lead', endpoint: 'both' }],
      language:  'en',
    })
    expect(out).toContain('Cancer and Reproductive Harm')
  })

  it('uses Spanish heading when language=es', () => {
    const out = buildShortFormWarning({
      chemicals: [{ name: 'BPA', endpoint: 'reproductive' }],
      language:  'es',
    })
    expect(out).toContain('Daño reproductivo')
  })

  it('does not list chemical names in short form', () => {
    const out = buildShortFormWarning({
      chemicals: [{ name: 'Benzene', endpoint: 'cancer' }],
      language:  'en',
    })
    expect(out).not.toContain('Benzene')
  })

  it('escalates to combined heading when chemicals span both endpoints', () => {
    const out = buildShortFormWarning({
      chemicals: [
        { name: 'Benzene', endpoint: 'cancer' },
        { name: 'BPA',     endpoint: 'reproductive' },
      ],
      language: 'en',
    })
    expect(out).toContain('Cancer and Reproductive Harm')
  })
})
