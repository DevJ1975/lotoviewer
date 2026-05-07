import { describe, it, expect } from 'vitest'
import { renderReleaseNoteMd } from '@/lib/markdown'

describe('renderReleaseNoteMd', () => {
  it('renders a simple paragraph', () => {
    const html = renderReleaseNoteMd('hello world')
    expect(html).toContain('<p')
    expect(html).toContain('hello world')
  })

  it('renders **bold**', () => {
    expect(renderReleaseNoteMd('**important**')).toContain('<strong>important</strong>')
  })

  it('renders a bullet list when every line starts with "- "', () => {
    const html = renderReleaseNoteMd('- one\n- two\n- three')
    expect(html).toContain('<ul')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>two</li>')
    expect(html).toContain('<li>three</li>')
  })

  it('does NOT make a list when only some lines start with -', () => {
    const html = renderReleaseNoteMd('- one\nplain text\n- three')
    expect(html).not.toContain('<ul')
    expect(html).toContain('<p')
  })

  it('treats blank lines as paragraph breaks', () => {
    const html = renderReleaseNoteMd('first\n\nsecond')
    expect(html.match(/<p/g)?.length).toBe(2)
  })

  it('renders [text](https://example.com) as a link', () => {
    const html = renderReleaseNoteMd('see [docs](https://example.com/docs)')
    expect(html).toContain('href="https://example.com/docs"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('>docs</a>')
  })

  it('rejects javascript: links — renders the label only', () => {
    const html = renderReleaseNoteMd('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('href=')
    expect(html).toContain('click')
  })

  it('rejects data: links', () => {
    const html = renderReleaseNoteMd('[click](data:text/html,<script>1</script>)')
    expect(html).not.toContain('href=')
  })

  // ── XSS — the entire reason for this renderer ─────────────────────────
  it('escapes raw <script> tags', () => {
    const html = renderReleaseNoteMd('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes <img onerror>', () => {
    const html = renderReleaseNoteMd('<img src=x onerror="alert(1)">')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('escapes raw HTML inside the body of a paragraph', () => {
    const html = renderReleaseNoteMd('hello <b>world</b>')
    expect(html).not.toContain('<b>world</b>')
    expect(html).toContain('&lt;b&gt;')
  })

  it('escapes raw HTML inside a link label', () => {
    const html = renderReleaseNoteMd('[<script>x</script>](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes ampersands and angle brackets in plain text', () => {
    const html = renderReleaseNoteMd('A & B < C')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;')
  })

  it('handles empty input', () => {
    expect(renderReleaseNoteMd('')).toBe('')
  })
})
