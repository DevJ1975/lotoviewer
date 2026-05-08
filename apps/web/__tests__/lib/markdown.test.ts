import { describe, it, expect } from 'vitest'
import { renderReleaseNoteMd, renderTalkMd } from '@/lib/markdown'

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

// ── renderTalkMd — adds h3 support on top of the release-note posture
describe('renderTalkMd', () => {
  it('renders a simple paragraph', () => {
    const html = renderTalkMd('hello world')
    expect(html).toContain('<p')
    expect(html).toContain('hello world')
  })

  it('renders ### Heading as an h3', () => {
    const html = renderTalkMd('### Why this matters')
    expect(html).toContain('<h3')
    expect(html).toContain('Why this matters')
  })

  it('does NOT render ## or # as headings (h3 is the only level supported)', () => {
    const html = renderTalkMd('# top\n\n## sub')
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('<h2')
    // The `#` characters survive as literal text in a paragraph.
    expect(html).toContain('# top')
    expect(html).toContain('## sub')
  })

  it('escapes script tags in heading content', () => {
    const html = renderTalkMd('### <script>alert(1)</script>')
    expect(html).toContain('<h3')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders bullet lists', () => {
    const html = renderTalkMd('- alpha\n- beta\n- gamma')
    expect(html).toContain('<ul')
    expect(html).toContain('<li>alpha</li>')
    expect(html).toContain('<li>beta</li>')
    expect(html).toContain('<li>gamma</li>')
  })

  it('renders **bold** inside body', () => {
    expect(renderTalkMd('this is **important**')).toContain('<strong>important</strong>')
  })

  it('renders multi-paragraph bodies on blank-line breaks', () => {
    const html = renderTalkMd('first paragraph\n\nsecond paragraph\n\nthird')
    expect(html.match(/<p/g)?.length).toBe(3)
  })

  it('preserves an h3 between two paragraphs', () => {
    const html = renderTalkMd('opening\n\n### Middle\n\nclosing')
    expect(html).toMatch(/<p[^>]*>opening/)
    expect(html).toMatch(/<h3[^>]*>Middle/)
    expect(html).toMatch(/<p[^>]*>closing/)
  })

  it('renders a https link with safe attributes', () => {
    const html = renderTalkMd('see [the standard](https://osha.gov/1910)')
    expect(html).toContain('href="https://osha.gov/1910"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('rejects javascript: links — label only', () => {
    const html = renderTalkMd('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('href=')
  })

  it('escapes <img onerror=> in a paragraph', () => {
    const html = renderTalkMd('see <img src=x onerror="alert(1)"> here')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('escapes a script tag injected at the start of the body', () => {
    const html = renderTalkMd('<script>alert(1)</script>\n\nnormal paragraph')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes ampersands and quotes', () => {
    const html = renderTalkMd('A & B "C"')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })

  it('handles empty input', () => {
    expect(renderTalkMd('')).toBe('')
  })

  it('handles whitespace-only input as empty', () => {
    expect(renderTalkMd('   \n   \n   ')).toBe('')
  })

  it('handles unicode subscripts that PDF generators sometimes mangle (O₂, H₂S, CO₂)', () => {
    // These are genuine OSHA terms in toolbox-talk content. We only
    // need them to round-trip safely as text — no need to escape any
    // of these to entities.
    const html = renderTalkMd('Watch O₂ levels and H₂S exposure when CO₂ is high.')
    expect(html).toContain('O₂')
    expect(html).toContain('H₂S')
    expect(html).toContain('CO₂')
  })

  it('does not render a single line with - inside (not a list start)', () => {
    // Subtle: "machine - guard" should NOT trigger list rendering.
    const html = renderTalkMd('replace the machine - guard')
    expect(html).not.toContain('<ul')
    expect(html).toContain('<p')
    expect(html).toContain('machine - guard')
  })

  it('handles a very long single paragraph (no truncation in renderer)', () => {
    const long = 'word '.repeat(2000).trim()  // ~10KB
    const html = renderTalkMd(long)
    expect(html).toContain('<p')
    expect(html.length).toBeGreaterThan(long.length)
  })

  it('escapes newlines inside a paragraph as <br>', () => {
    const html = renderTalkMd('line one\nline two')
    expect(html).toContain('<br>')
    expect(html).toContain('line one')
    expect(html).toContain('line two')
  })
})
