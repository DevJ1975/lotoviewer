import { describe, it, expect } from 'vitest'
import {
  htmlToLlmText,
  computeDedupKey,
  normalizeOshaUpdate,
  type RawOshaItem,
} from '@/lib/oshaRegWatch'

// A complete, valid model item — tests override single fields from this.
function rawItem(over: Partial<RawOshaItem> = {}): RawOshaItem {
  return {
    title:          'Walking-Working Surfaces; Final Rule',
    category:       'final_rule',
    is_upcoming:    false,
    source_url:     'https://www.osha.gov/laws-regs/rule/1910-22',
    published_date: '2026-05-01',
    effective_date: '',
    comment_close_date: '',
    impact_summary: 'Employers must inspect walking surfaces and document repairs.',
    severity:       'high',
    ...over,
  }
}

describe('htmlToLlmText', () => {
  it('drops script and style content entirely', () => {
    const html = `
      <head><title>nav</title></head>
      <style>.a{color:red}</style>
      <p>Real content</p>
      <script>window.tracker = 'SECRET_PAYLOAD'</script>
    `
    const out = htmlToLlmText(html)
    expect(out).toContain('Real content')
    expect(out).not.toContain('SECRET_PAYLOAD')
    expect(out).not.toContain('color:red')
    expect(out).not.toContain('nav')
  })

  it('renders anchors as "text (absolute-url)" and resolves relative hrefs', () => {
    const html = '<a href="/laws-regs/rule/1910-22">New rule</a>'
    expect(htmlToLlmText(html)).toContain('New rule (https://www.osha.gov/laws-regs/rule/1910-22)')
  })

  it('keeps absolute hrefs intact', () => {
    const html = '<a href="https://www.federalregister.gov/d/2026-1">FR doc</a>'
    expect(htmlToLlmText(html)).toContain('FR doc (https://www.federalregister.gov/d/2026-1)')
  })

  it('decodes common HTML entities', () => {
    expect(htmlToLlmText('<p>Health &amp; Safety</p>')).toContain('Health & Safety')
  })

  it('caps output length so a huge page cannot blow the prompt budget', () => {
    const html = `<p>${'x'.repeat(80_000)}</p>`
    expect(htmlToLlmText(html).length).toBeLessThanOrEqual(40_000)
  })
})

describe('computeDedupKey', () => {
  it('is stable for the same source URL (idempotency)', () => {
    const a = computeDedupKey({ source_url: 'https://www.osha.gov/x', title: 'A', published_date: '2026-05-01' })
    const b = computeDedupKey({ source_url: 'https://www.osha.gov/x', title: 'A', published_date: '2026-05-01' })
    expect(a).toBe(b)
  })

  it('ignores title/date when a URL is present (survives headline edits)', () => {
    const a = computeDedupKey({ source_url: 'https://www.osha.gov/x', title: 'Old headline', published_date: '2026-05-01' })
    const b = computeDedupKey({ source_url: 'https://www.osha.gov/x', title: 'New headline', published_date: null })
    expect(a).toBe(b)
  })

  it('differs for different URLs', () => {
    const a = computeDedupKey({ source_url: 'https://www.osha.gov/x', title: 'A', published_date: null })
    const b = computeDedupKey({ source_url: 'https://www.osha.gov/y', title: 'A', published_date: null })
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
