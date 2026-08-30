import { describe, it, expect } from 'vitest'
import {
  federalRegisterDocsToLlmText,
  calOshaPagesToLlmText,
  htmlToPlainText,
  computeDedupKey,
  normalizeOshaUpdate,
  type FederalRegisterDoc,
  type RawOshaItem,
} from '@/lib/oshaRegWatch'

// A complete Federal Register document — tests override single fields.
function frDoc(over: Partial<FederalRegisterDoc> = {}): FederalRegisterDoc {
  return {
    document_number:   '2026-12345',
    title:             'Walking-Working Surfaces; Final Rule',
    type:              'Rule',
    publication_date:  '2026-05-01',
    effective_on:      '2026-07-01',
    comments_close_on: null,
    abstract:          'OSHA is amending its walking-working surfaces standard.',
    html_url:          'https://www.federalregister.gov/documents/2026/05/01/2026-12345/walking-working-surfaces',
    ...over,
  }
}

// A complete, valid model item — tests override single fields from this.
function rawItem(over: Partial<RawOshaItem> = {}): RawOshaItem {
  return {
    title:          'Walking-Working Surfaces; Final Rule',
    category:       'final_rule',
    is_upcoming:    false,
    source_url:     'https://www.federalregister.gov/documents/2026/05/01/2026-12345/walking-working-surfaces',
    published_date: '2026-05-01',
    effective_date: '2026-07-01',
    comment_close_date: '',
    impact_summary: 'Employers must inspect walking surfaces and document repairs.',
    severity:       'high',
    ...over,
  }
}

describe('federalRegisterDocsToLlmText', () => {
  it('serializes a document into labeled lines', () => {
    const out = federalRegisterDocsToLlmText([frDoc()])
    expect(out).toContain('Title: Walking-Working Surfaces; Final Rule')
    expect(out).toContain('Type: Rule')
    expect(out).toContain('Published: 2026-05-01')
    expect(out).toContain('Effective: 2026-07-01')
    expect(out).toContain('URL: https://www.federalregister.gov/documents/2026/05/01/2026-12345/walking-working-surfaces')
    expect(out).toContain('Abstract: OSHA is amending its walking-working surfaces standard.')
  })

  it('omits optional fields that are absent', () => {
    const out = federalRegisterDocsToLlmText([frDoc({ effective_on: null, comments_close_on: null, abstract: null })])
    expect(out).not.toContain('Effective:')
    expect(out).not.toContain('Comments close:')
    expect(out).not.toContain('Abstract:')
    // Required-ish labels still present.
    expect(out).toContain('Title:')
    expect(out).toContain('Type:')
  })

  it('includes a comment-close line for proposed rules', () => {
    const out = federalRegisterDocsToLlmText([frDoc({ type: 'Proposed Rule', comments_close_on: '2026-08-15' })])
    expect(out).toContain('Comments close: 2026-08-15')
  })

  it('joins multiple documents with a delimiter', () => {
    const out = federalRegisterDocsToLlmText([
      frDoc({ title: 'Doc One' }),
      frDoc({ title: 'Doc Two' }),
    ])
    expect(out).toContain('Doc One')
    expect(out).toContain('Doc Two')
    expect(out).toContain('---')
  })

  it('caps output length so a huge batch cannot blow the prompt budget', () => {
    const docs = Array.from({ length: 50 }, () => frDoc({ abstract: 'x'.repeat(5_000) }))
    expect(federalRegisterDocsToLlmText(docs).length).toBeLessThanOrEqual(40_000)
  })
})

describe('computeDedupKey', () => {
  it('is stable for the same source URL (idempotency)', () => {
    const a = computeDedupKey({ source_url: 'https://www.federalregister.gov/d/x', title: 'A', published_date: '2026-05-01' })
    const b = computeDedupKey({ source_url: 'https://www.federalregister.gov/d/x', title: 'A', published_date: '2026-05-01' })
    expect(a).toBe(b)
  })

  it('ignores title/date when a URL is present (survives headline edits)', () => {
    const a = computeDedupKey({ source_url: 'https://www.federalregister.gov/d/x', title: 'Old headline', published_date: '2026-05-01' })
    const b = computeDedupKey({ source_url: 'https://www.federalregister.gov/d/x', title: 'New headline', published_date: null })
    expect(a).toBe(b)
  })

  it('differs for different URLs', () => {
    const a = computeDedupKey({ source_url: 'https://www.federalregister.gov/d/x', title: 'A', published_date: null })
    const b = computeDedupKey({ source_url: 'https://www.federalregister.gov/d/y', title: 'A', published_date: null })
    expect(a).not.toBe(b)
  })

  it('falls back to title+date when no URL, and never returns empty', () => {
    const k = computeDedupKey({ source_url: '', title: 'No-URL item', published_date: '2026-05-01' })
    expect(k).toMatch(/^[0-9a-f]{40}$/)
    const same = computeDedupKey({ source_url: '', title: 'No-URL item', published_date: '2026-05-01' })
    expect(k).toBe(same)
    const diff = computeDedupKey({ source_url: '', title: 'No-URL item', published_date: '2026-06-01' })
    expect(k).not.toBe(diff)
  })
})

describe('normalizeOshaUpdate', () => {
  it('rejects items missing a title or impact summary', () => {
    expect(normalizeOshaUpdate(rawItem({ title: '   ' }))).toBeNull()
    expect(normalizeOshaUpdate(rawItem({ impact_summary: '' }))).toBeNull()
  })

  it('preserves valid ISO dates and nulls out empty/invalid ones', () => {
    const out = normalizeOshaUpdate(rawItem({
      published_date: '2026-05-01',
      effective_date: '',
      comment_close_date: '2026-13-40', // impossible date the regex would pass
    }))
    expect(out?.published_date).toBe('2026-05-01')
    expect(out?.effective_date).toBeNull()
    expect(out?.comment_close_date).toBeNull()
  })

  it('degrades an unknown category to "other" and unknown severity to null', () => {
    const out = normalizeOshaUpdate(rawItem({ category: 'press-release', severity: 'urgent' }))
    expect(out?.category).toBe('other')
    expect(out?.severity).toBeNull()
  })

  it('keeps known category/severity and coerces is_upcoming to a strict boolean', () => {
    const out = normalizeOshaUpdate(rawItem({ category: 'proposed_rule', severity: 'medium', is_upcoming: true }))
    expect(out?.category).toBe('proposed_rule')
    expect(out?.severity).toBe('medium')
    expect(out?.is_upcoming).toBe(true)
  })

  it('trims whitespace from title and summary', () => {
    const out = normalizeOshaUpdate(rawItem({ title: '  Spaced title  ', impact_summary: '  body  ' }))
    expect(out?.title).toBe('Spaced title')
    expect(out?.impact_summary).toBe('body')
  })
})

describe('htmlToPlainText', () => {
  it('drops script and style bodies rather than leaking their text', () => {
    const html = '<style>.a{color:red}</style><p>Real text</p><script>var x=1</script>'
    const out = htmlToPlainText(html)
    expect(out).toContain('Real text')
    expect(out).not.toContain('color:red')
    expect(out).not.toContain('var x')
  })

  it('decodes entities and collapses whitespace', () => {
    expect(htmlToPlainText('<p>Title&nbsp;&amp;   Scope</p>')).toBe('Title & Scope')
  })

  it('keeps block boundaries as newlines so list items do not run together', () => {
    expect(htmlToPlainText('<li>First</li><li>Second</li>')).toBe('First\nSecond')
  })
})

describe('calOshaPagesToLlmText', () => {
  const page = (over: Partial<{ url: string; label: string; text: string }> = {}) => ({
    url:   'https://www.dir.ca.gov/oshsb/proposedregulations.html',
    label: 'Cal/OSHA Standards Board — proposed regulations',
    text:  'Section 3396 indoor heat. Public hearing scheduled.',
    ...over,
  })

  it('labels each block with its source and URL so the model can echo the URL back', () => {
    const out = calOshaPagesToLlmText([page()])
    expect(out).toContain('Source: Cal/OSHA Standards Board — proposed regulations')
    expect(out).toContain('URL: https://www.dir.ca.gov/oshsb/proposedregulations.html')
    expect(out).toContain('Section 3396 indoor heat.')
  })

  it('skips pages that stripped down to nothing', () => {
    expect(calOshaPagesToLlmText([page({ text: '   ' })])).toBe('')
  })
})

describe('computeDedupKey — jurisdiction scoping', () => {
  // Federal keys predate the jurisdiction column. If they changed, the next
  // cron run would re-insert the entire stored feed under new keys.
  it('leaves federal keys byte-identical to the un-scoped key', () => {
    const item = { source_url: 'https://example.gov/a', title: 'A', published_date: '2026-01-01' }
    expect(computeDedupKey({ ...item, jurisdiction: 'federal' })).toBe(computeDedupKey(item))
  })

  it('separates California from federal on the URL-less fallback path', () => {
    const item = { source_url: '', title: 'Heat', published_date: '2026-01-01' }
    expect(computeDedupKey({ ...item, jurisdiction: 'CA' }))
      .not.toBe(computeDedupKey({ ...item, jurisdiction: 'federal' }))
  })
})

describe('normalizeOshaUpdate — jurisdiction', () => {
  it('defaults to federal', () => {
    expect(normalizeOshaUpdate(rawItem())?.jurisdiction).toBe('federal')
  })

  it('stamps the jurisdiction the pass was run for', () => {
    expect(normalizeOshaUpdate(rawItem(), 'CA')?.jurisdiction).toBe('CA')
  })
})
