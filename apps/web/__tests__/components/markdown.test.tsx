import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from '@/components/ui/markdown'

// The assistant renders model-supplied markdown. RAG-retrieved chunks or
// tenant-uploaded policies could contain crafted links we don't trust,
// so the renderer must (a) render only allowlisted href schemes as <a>
// tags and (b) fall back to plain text for everything else.

describe('Markdown link sanitization', () => {
  it('renders http(s) links as anchors with rel=noreferrer', () => {
    const { container } = render(<Markdown text="See [OSHA](https://osha.gov/1910.147) for details." />)
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('https://osha.gov/1910.147')
    expect(a?.getAttribute('rel')).toBe('noreferrer')
    expect(a?.getAttribute('target')).toBe('_blank')
  })

  it('renders mailto links as anchors', () => {
    const { container } = render(<Markdown text="Contact [us](mailto:safety@example.com)." />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('mailto:safety@example.com')
  })

  it('renders tel links as anchors', () => {
    const { container } = render(<Markdown text="Call [hotline](tel:5551234)." />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('tel:5551234')
  })

  it('renders relative paths as anchors without target=_blank', () => {
    const { container } = render(<Markdown text="Open [/equipment/abc](/equipment/abc)." />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('/equipment/abc')
    expect(a?.getAttribute('target')).toBeNull()
  })

  it('does NOT render javascript: links as anchors', () => {
    const { container } = render(<Markdown text="Click [me](javascript:alert(1))." />)
    expect(container.querySelector('a')).toBeNull()
    // The unsafe form should appear as plain text — verifies the user can
    // still see what the model produced even if we refuse to link it.
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeInTheDocument()
  })

  it('does NOT render data: links as anchors', () => {
    const { container } = render(<Markdown text="Open [me](data:text/html,<script>alert(1)</script>)." />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('does NOT render vbscript: links as anchors', () => {
    const { container } = render(<Markdown text="Click [me](vbscript:msgbox(1))." />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('rejects schemes with leading whitespace (no leading-space bypass)', () => {
    const { container } = render(<Markdown text="Click [me]( javascript:alert(1))." />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('rejects mixed-case javascript: scheme', () => {
    const { container } = render(<Markdown text="Click [me](JaVaScRiPt:alert(1))." />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('rejects empty href', () => {
    const { container } = render(<Markdown text="Click [me]()." />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('renders a hash anchor (in-page nav) as a safe anchor', () => {
    const { container } = render(<Markdown text="See [section](#energy-sources)." />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('#energy-sources')
  })
})

describe('Markdown core rendering', () => {
  it('renders bold text inside an anchor', () => {
    const { container } = render(<Markdown text="[**Bold link**](https://example.com)" />)
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.querySelector('strong')).not.toBeNull()
  })

  it('renders an unordered list', () => {
    const { container } = render(<Markdown text={'- one\n- two\n- three'} />)
    const items = container.querySelectorAll('ul > li')
    expect(items.length).toBe(3)
  })

  it('renders a heading at the requested level', () => {
    const { container } = render(<Markdown text="### Heading" />)
    expect(container.querySelector('h3')).not.toBeNull()
  })

  it('renders fenced code blocks verbatim (HTML inside is escaped)', () => {
    const { container } = render(<Markdown text={'```\n<script>alert(1)</script>\n```'} />)
    const code = container.querySelector('pre code')
    expect(code?.textContent).toBe('<script>alert(1)</script>')
    // React escapes HTML in text nodes — there should be no actual <script> tag.
    expect(container.querySelector('script')).toBeNull()
  })

  it('handles empty input without rendering paragraphs/lists/headings', () => {
    const { container } = render(<Markdown text="" />)
    expect(container.querySelectorAll('p, li, h1, h2, h3, pre, ol, ul').length).toBe(0)
  })
})
